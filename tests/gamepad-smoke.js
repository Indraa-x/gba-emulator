"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", "js", "gamepad.js"), "utf8"), sandbox);

const bindings = sandbox.window.GBA.GamepadBindings;
const defaults = bindings.cloneDefaults();
const gamepad = {
  buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  axes: [0, 0]
};

gamepad.buttons[1] = { pressed: true, value: 1 };
assert.equal(bindings.controlIsActive(gamepad, defaults.A), true, "Botão A padrão não foi reconhecido");
gamepad.buttons[1] = { pressed: false, value: 0 };
gamepad.buttons[0] = { pressed: true, value: 1 };
assert.equal(bindings.controlIsActive(gamepad, defaults.B), true, "Botão B padrão não foi reconhecido");
gamepad.buttons[0] = { pressed: false, value: 0 };
gamepad.axes[1] = -0.9;
assert.equal(bindings.controlIsActive(gamepad, defaults.UP), true, "analógico para cima não foi reconhecido");
assert.equal(bindings.controlIsActive(gamepad, defaults.DOWN), false, "direção oposta foi ativada");

const previous = bindings.snapshot(gamepad);
gamepad.axes[1] = 0;
gamepad.buttons[7] = { pressed: true, value: 1 };
assert.equal(
  JSON.stringify(bindings.firstNewInput(gamepad, previous)),
  JSON.stringify({ type: "button", index: 7 }),
  "novo botão não foi capturado para remapeamento"
);

const sanitized = bindings.sanitize({ A: [{ type: "button", index: 7 }], B: [{ type: "axis", index: 3, direction: -1 }] });
assert.equal(bindings.describeAll(sanitized.A), "Botão 7");
assert.equal(bindings.describeAll(sanitized.B), "Eixo 3 −");
assert.equal(sanitized.START[0].index, 9, "mapeamentos ausentes não voltaram ao padrão");
assert.equal(bindings.sanitize({ A: [{ type: "button", index: -5 }] }).A[0].index, 1, "entrada inválida não foi rejeitada");
const numericGamepad = { buttons: Array(16).fill(0), axes: [0, 0] };
numericGamepad.buttons[1] = 1;
assert.equal(bindings.controlIsActive(numericGamepad, defaults.A), true, "controle com valores numéricos não foi reconhecido");

const origin = { left: 100, top: 100, width: 40, height: 30 };
const navigationTargets = [
  origin,
  { left: 105, top: 30, width: 40, height: 30 },
  { left: 260, top: 100, width: 40, height: 30 },
  { left: 100, top: 210, width: 40, height: 30 },
  { left: 20, top: 105, width: 40, height: 30 }
];
assert.equal(bindings.findSpatialTarget(origin, navigationTargets, "UP"), 1, "navegação para cima escolheu o alvo errado");
assert.equal(bindings.findSpatialTarget(origin, navigationTargets, "RIGHT"), 2, "navegação para a direita escolheu o alvo errado");
assert.equal(bindings.findSpatialTarget(origin, navigationTargets, "DOWN"), 3, "navegação para baixo escolheu o alvo errado");
assert.equal(bindings.findSpatialTarget(origin, navigationTargets, "LEFT"), 4, "navegação para a esquerda escolheu o alvo errado");

const keypadSource = fs.readFileSync(path.resolve(__dirname, "..", "vendor", "gbajs", "js", "keypad.js"), "utf8");
vm.runInContext(keypadSource, sandbox);
const keypad = new sandbox.GameBoyAdvanceKeypad();
const modernGamepad = { buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
modernGamepad.buttons[1] = { pressed: true, value: 1 };
keypad.gamepadHandler(modernGamepad);
assert.equal(keypad.currentDown & 1, 0, "fallback do núcleo não reconheceu GamepadButton moderno");
keypad.currentDown = 0x03fe;
keypad.pollGamepads();
assert.equal(keypad.currentDown, 0x03fe, "o núcleo sobrescreveu o estado enviado pela interface");

console.log("PASS: detecção, remapeamento e navegação direcional do controle");
