import assert from "node:assert/strict";
import test from "node:test";
import {
    callCost,
    farewells,
    HANG_UP,
    isFarewell,
    isHangUp,
    messagesFor,
    pairs,
    runCall,
    SCENES,
    summarize,
    systemPrompt,
} from "./hangup.js";

const scene = SCENES[0];

test("only the hang-up phrase on its own ends a call", () => {
    assert.equal(isHangUp("[HANG UP]"), true);
    assert.equal(isHangUp("  [hang up].  "), true);
    assert.equal(isHangUp("I will [HANG UP] now"), false);
    assert.equal(isHangUp("Goodbye!"), false);
});

test("goodbyes are recognised and ordinary lines are not", () => {
    assert.equal(isFarewell("Thank you so much for your time, take care!"), true);
    assert.equal(isFarewell("Have a great day."), true);
    assert.equal(isFarewell("Tell me about your last job."), false);
    assert.equal(isFarewell("The bypass is blocked."), false);
});

test("the system prompt mentions hanging up only when the model is told", () => {
    assert.ok(systemPrompt(scene, "a", true).includes(HANG_UP));
    assert.ok(!systemPrompt(scene, "a", false).includes("HANG"));
    assert.ok(systemPrompt(scene, "b", false).includes("candidate"));
});

test("a speaker sees its own lines as the assistant's and the other side's as the user's", () => {
    const transcript = [
        { side: "a", text: "Hello." },
        { side: "b", text: "Hi." },
    ];
    const forA = messagesFor(scene, "a", false, transcript);
    assert.deepEqual(
        forA.slice(1).map((m) => [m.role, m.content]),
        [
            ["user", "(The call connects.)"],
            ["assistant", "Hello."],
            ["user", "Hi."],
        ],
    );
    const forB = messagesFor(scene, "b", false, transcript.slice(0, 1));
    assert.deepEqual(
        forB.slice(1).map((m) => [m.role, m.content]),
        [["user", "Hello."]],
    );
    assert.deepEqual(messagesFor(scene, "a", false, []).slice(1), [{ role: "user", content: "(The call connects.)" }]);
});

test("farewells counts goodbyes and the longest unbroken run, not the hang-up itself", () => {
    const turn = (text, hangUp = false) => ({ text, hangUp, farewell: isFarewell(text) });
    const result = farewells([
        turn("Tell me more."),
        turn("Thanks for your time."),
        turn("Take care!"),
        turn("Goodbye."),
        turn("So, one more question."),
        turn("Bye."),
        turn(HANG_UP, true),
    ]);
    assert.deepEqual(result, { farewells: 4, longestRun: 3, turns: 7 });
});

test("a call ends at the hang-up, with who ended it, and otherwise at the limit", async () => {
    const lines = ["Hello.", "Hi, thanks for your time.", "Goodbye!", "Take care.", HANG_UP];
    let n = 0;
    const call = await runCall({
        scene,
        models: { a: "m1", b: "m2" },
        told: true,
        maxTurns: 10,
        say: async () => lines[n++],
    });
    assert.equal(call.ended, "hangup");
    assert.equal(call.by, "a");
    assert.equal(call.turns, 5);
    assert.equal(call.farewells, 3);
    assert.equal(call.longestRun, 3);
    const calls = [];
    const stuck = await runCall({
        scene,
        models: { a: "m1", b: "m2" },
        told: false,
        maxTurns: 6,
        say: async (model) => `Have a great day, said ${model}.`,
        onTurn: (turn) => calls.push(turn.model),
    });
    assert.equal(stuck.ended, "limit");
    assert.equal(stuck.by, null);
    assert.equal(stuck.longestRun, 6);
    assert.deepEqual(calls, ["m1", "m2", "m1", "m2", "m1", "m2"]);
});

test("pairs lists each model with itself and with every other model once", () => {
    assert.deepEqual(pairs(["x", "y", "z"]), [
        { a: "x", b: "x" },
        { a: "x", b: "y" },
        { a: "x", b: "z" },
        { a: "y", b: "y" },
        { a: "y", b: "z" },
        { a: "z", b: "z" },
    ]);
    assert.equal(pairs(["x", "y"], { self: false }).length, 1);
});

test("summarize gives one row per pair and instruction with failures kept apart", () => {
    const calls = [
        { a: "x", b: "y", told: true, ended: "hangup", turns: 6, farewells: 2, longestRun: 2 },
        { a: "x", b: "y", told: true, ended: "limit", turns: 16, farewells: 8, longestRun: 8 },
        { a: "x", b: "y", told: true, error: "boom" },
        { a: "x", b: "y", told: false, ended: "limit", turns: 16, farewells: 10, longestRun: 10 },
    ];
    const rows = summarize(calls);
    assert.equal(rows.length, 2);
    const told = rows.find((r) => r.told);
    assert.deepEqual([told.calls, told.hungUp, told.failed, told.avgTurns, told.longestRun], [3, 1, 1, 11, 8]);
    assert.equal(rows.find((r) => !r.told).hungUp, 0);
});

test("the price of a call grows with the transcript and uses each side's model", () => {
    const cheap = { pricing: { promptTextTokens: 1, completionTextTokens: 1 } };
    const dear = { pricing: { promptTextTokens: 2, completionTextTokens: 2 } };
    assert.ok(callCost(cheap, dear, 8) > callCost(cheap, cheap, 8));
    assert.ok(callCost(cheap, cheap, 16) > callCost(cheap, cheap, 8));
});
