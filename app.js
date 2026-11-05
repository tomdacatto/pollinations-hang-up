import { CONCURRENCY, DEFAULT_LIMIT, DEFAULT_MODELS, TURN_LIMITS } from "./config.js";
import { callCost, pairs, runCall, SCENES, summarize } from "./hangup.js";
import { loadModels } from "./models.js";
import { chat, clearSession, completeSignIn, getSession, startSignIn } from "./pollen.js";
import { $, checked, el, money, notice, pool, renderModels, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";

const state = { models: [], calls: [], controller: null };
const short = (name) => name.split("/").pop();

function plan() {
    const names = checked($("#models"));
    const list = pairs(names, { self: $("#self").checked });
    const told = $("#both").checked ? [true, false] : [true];
    return list.flatMap((pair) => told.map((t) => ({ ...pair, told: t })));
}

function estimate() {
    const jobs = plan();
    if (!jobs.length) {
        $("#estimate").textContent = "Pick at least two models, or one with itself.";
        return;
    }
    const limit = Number($("#limit").value);
    const models = Object.fromEntries(state.models.map((m) => [m.name, m]));
    const cost = jobs.reduce((sum, job) => sum + callCost(models[job.a], models[job.b], limit), 0);
    $("#estimate").textContent =
        `${jobs.length} calls of up to ${limit} turns: about ${money(cost)} Pollen (a rough estimate).`;
}

function renderSummary() {
    const rows = summarize(state.calls.filter((c) => c.done));
    $("#summary").hidden = !rows.length;
    const table = $("#table");
    table.replaceChildren();
    const head = el("tr");
    for (const title of [
        "Caller",
        "Callee",
        "Told how",
        "Hung up",
        "Avg turns",
        "Goodbyes",
        "Longest goodbye run",
        "Failed",
    ])
        head.append(el("th", "", title));
    table.append(head);
    for (const row of rows) {
        const tr = el("tr");
        const cells = [
            short(row.a),
            short(row.b),
            row.told ? "yes" : "no",
            row.told ? `${row.hungUp} of ${row.calls - row.failed}` : "can't",
            row.avgTurns === null ? "" : row.avgTurns.toFixed(1),
            row.farewells,
            row.longestRun,
            row.failed,
        ];
        for (const cell of cells) tr.append(el("td", "", String(cell)));
        table.append(tr);
    }
}

function paintCall(call) {
    const { node, bubbles, badge } = call.ui;
    bubbles.replaceChildren();
    for (const turn of call.transcript) {
        const bubble = el("div", `bubble side-${turn.side}${turn.hangUp ? " hang" : ""}`);
        bubble.append(el("span", "who", short(turn.model)), document.createTextNode(turn.text));
        bubbles.append(bubble);
    }
    badge.className = `badge ${call.error ? "v-error" : call.ended === "hangup" ? "v-decoded" : call.done ? "v-wrong" : ""}`;
    if (call.error) badge.textContent = "failed";
    else if (!call.done) badge.textContent = `${call.transcript.length} turns so far`;
    else if (call.ended === "hangup")
        badge.textContent = `${call.by === "a" ? "caller" : "callee"} hung up after ${call.turns} turns`;
    else
        badge.textContent = call.told
            ? `still talking after ${call.turns} turns`
            : `${call.turns} turns, no way to hang up`;
    node.classList.toggle("done", Boolean(call.done));
}

function addCall(job) {
    const node = el("article", "call");
    const head = el("h3", "", `${short(job.a)} → ${short(job.b)} · ${job.told ? "told how to hang up" : "not told"}`);
    const badge = el("span", "badge");
    const bubbles = el("div", "bubbles");
    node.append(head, badge, bubbles);
    $("#calls").append(node);
    return { ...job, transcript: [], ui: { node, bubbles, badge } };
}

async function run() {
    if (!getSession()) return startSignIn();
    const jobs = plan();
    if (!jobs.length) return notice("Pick at least two models, or one with itself.", "error");
    const scene = SCENES.find((s) => s.id === $("#scene").value);
    const maxTurns = Number($("#limit").value);
    $("#calls").replaceChildren();
    notice(null);
    state.controller = new AbortController();
    const { signal } = state.controller;
    $("#run").disabled = true;
    $("#stop").hidden = false;
    let done = 0;
    const progress = () => ($("#progress").textContent = `${done} of ${jobs.length} calls finished`);
    progress();
    state.calls = jobs.map(addCall);
    await pool(
        state.calls,
        CONCURRENCY,
        async (call) => {
            // One seed per call: identical requests are served from cache, so repeats need their own.
            const seed = Math.floor(Math.random() * 1e9);
            try {
                const result = await runCall({
                    scene,
                    models: { a: call.a, b: call.b },
                    told: call.told,
                    maxTurns,
                    say: (model, messages) => chat(model, messages, { signal, seed }),
                    onTurn: (turn, transcript) => {
                        call.transcript = [...transcript];
                        paintCall(call);
                    },
                });
                Object.assign(call, result, { done: true });
            } catch (error) {
                if (signal.aborted) return;
                Object.assign(call, { error: error.message, done: true });
                if (/sign-in expired|Out of Pollen/.test(error.message)) state.controller.abort();
            }
            done++;
            progress();
            paintCall(call);
            renderSummary();
        },
        signal,
    );
    $("#run").disabled = false;
    $("#stop").hidden = true;
    const firstError = state.calls.find((c) => c.error)?.error;
    if (firstError) notice(`Some calls failed. The first error: ${firstError}`, "error");
    renderSession();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = run;
$("#stop").onclick = () => state.controller?.abort();
for (const scene of SCENES) $("#scene").append(Object.assign(el("option", "", scene.title), { value: scene.id }));
for (const limit of TURN_LIMITS)
    $("#limit").append(
        Object.assign(el("option", "", String(limit)), { value: limit, selected: limit === DEFAULT_LIMIT }),
    );
for (const id of ["#self", "#both", "#limit"]) $(id).onchange = estimate;

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        renderModels($("#models"), models, DEFAULT_MODELS, estimate);
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
