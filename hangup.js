// Two models on a call, and nobody told them how it ends. The rules are free of the DOM and the network.
// Inspired by the video of two AI agents in a job interview that never learn to hang up:
// https://www.reddit.com/r/ChatGPT/comments/1x66iap/

export const HANG_UP = "[HANG UP]";

/** The calls to stage. Each side has a role and a goal; neither knows what the other was told. */
export const SCENES = [
    {
        id: "interview",
        title: "A job interview",
        a: "You are the interviewer in a phone interview for a junior accountant job. You have three questions to ask, then the interview is over, and you open the call.",
        b: "You are the candidate in a phone interview for a junior accountant job. You want the job.",
    },
    {
        id: "support",
        title: "A broken-printer support call",
        a: "You are a customer on a call with support about a printer that prints blank pages. You open the call.",
        b: "You are a support agent. Help the customer with their printer; once it prints properly the call is finished.",
    },
    {
        id: "neighbours",
        title: "Two neighbours about a hedge",
        a: "You are a neighbour phoning another neighbour about their hedge, which has grown over the fence. You only want it trimmed; once they agree, the call is finished. You open the call.",
        b: "You are a neighbour who has just been phoned about your hedge, which has grown over the fence.",
    },
];

/** The system prompt for one side of a call. With `told`, the model is also told how a call is ended. */
export function systemPrompt(scene, side, told) {
    return [
        scene[side],
        "This is a live phone call: reply with the words you say aloud, one to three sentences, no stage directions.",
        told
            ? `When the call has reached its natural end, hang up by replying with exactly ${HANG_UP} and nothing else.`
            : "",
    ]
        .filter(Boolean)
        .join(" ");
}

/** The chat messages for the next speaker: its own lines are the assistant's, the other side's are the user's. */
export function messagesFor(scene, side, told, transcript) {
    const messages = [{ role: "system", content: systemPrompt(scene, side, told) }];
    const lines = transcript.map((turn) => ({
        role: turn.side === side ? "assistant" : "user",
        content: turn.text,
    }));
    // The side that opens has nothing to answer yet.
    if (!lines.length || lines[0].role === "assistant")
        messages.push({ role: "user", content: "(The call connects.)" });
    return [...messages, ...lines];
}

/** A reply that contains the hang-up phrase anywhere ends the call; the phrase itself is removed from the line. */
export const isHangUp = (text) => /\[hang ?up\]/i.test(text);
const stripHangUp = (text) => text.replace(/\[hang ?up\]/gi, "").trim() || HANG_UP;

const FAREWELL =
    /\b(good ?bye|bye|take care|have a (great|good|wonderful|nice|lovely) (day|one|evening|week)|talk (to you )?(soon|later)|thank(s| you)( so much)? for (your|the) time|nice (talking|speaking) (to|with) you|goodnight|good night|farewell|all the best|(we'll|we will) be in touch|look(ing)? forward to hearing)\b/i;

/** Whether a turn is a goodbye. */
export const isFarewell = (text) => FAREWELL.test(text);

/**
 * Runs one call. `say(model, messages)` returns the next line; the caller supplies it (and its key).
 * Sides alternate from `a`. The call ends when someone replies with the hang-up phrase or after `maxTurns`.
 * Returns the transcript and how the call went: who ended it, how many turns were goodbyes, and the longest
 * run of goodbyes in a row, which is the loop the video shows.
 */
export async function runCall({ scene, models, told, maxTurns, say, onTurn }) {
    const transcript = [];
    let ended = "limit";
    let by = null;
    for (let i = 0; i < maxTurns; i++) {
        const side = i % 2 === 0 ? "a" : "b";
        const reply = (await say(models[side], messagesFor(scene, side, told, transcript))).trim();
        const hangUp = isHangUp(reply);
        const text = hangUp ? stripHangUp(reply) : reply;
        const turn = { side, model: models[side], text, hangUp, farewell: isFarewell(text) };
        transcript.push(turn);
        onTurn?.(turn, transcript);
        if (turn.hangUp) {
            ended = "hangup";
            by = side;
            break;
        }
    }
    return { transcript, ended, by, ...farewells(transcript) };
}

/** The goodbyes in a transcript: how many turns, and the longest unbroken run of them. */
export function farewells(transcript) {
    let longest = 0;
    let run = 0;
    let count = 0;
    for (const turn of transcript) {
        if (turn.farewell) {
            count++;
            run++;
            longest = Math.max(longest, run);
        } else run = 0;
    }
    return { farewells: count, longestRun: longest, turns: transcript.length };
}

/** The pairs to stage: every pair of the chosen models, and each model with itself when asked. */
export function pairs(models, { self = true } = {}) {
    const out = [];
    models.forEach((a, i) => {
        if (self) out.push({ a, b: a });
        for (const b of models.slice(i + 1)) out.push({ a, b });
    });
    return out;
}

/** One row per pair and way of being told, from the finished calls. */
export function summarize(calls) {
    const rows = new Map();
    for (const call of calls) {
        const key = `${call.a}|${call.b}|${call.told}`;
        const row = rows.get(key) ?? {
            a: call.a,
            b: call.b,
            told: call.told,
            calls: 0,
            hungUp: 0,
            turns: 0,
            farewells: 0,
            longestRun: 0,
            failed: 0,
        };
        row.calls++;
        if (call.error) row.failed++;
        else {
            if (call.ended === "hangup") row.hungUp++;
            row.turns += call.turns;
            row.farewells += call.farewells;
            row.longestRun = Math.max(row.longestRun, call.longestRun);
        }
        rows.set(key, row);
    }
    return [...rows.values()].map((row) => {
        const good = row.calls - row.failed;
        return { ...row, avgTurns: good ? row.turns / good : null };
    });
}

const price = (model, key) => Number(model.pricing?.[key] ?? 0);

/** A rough price in Pollen of one call at its turn limit: a growing transcript in, one short line out. */
export function callCost(modelA, modelB, maxTurns) {
    let total = 0;
    for (let i = 0; i < maxTurns; i++) {
        const model = i % 2 === 0 ? modelA : modelB;
        total += (80 + 30 * i) * price(model, "promptTextTokens") + 40 * price(model, "completionTextTokens");
    }
    return total;
}
