(function (GBA) {
  "use strict";

  const CONTROLS = Object.freeze(["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "L", "R", "START", "SELECT"]);
  const DEFAULT_BINDINGS = Object.freeze({
    UP: Object.freeze([{ type: "button", index: 12 }, { type: "axis", index: 1, direction: -1 }]),
    DOWN: Object.freeze([{ type: "button", index: 13 }, { type: "axis", index: 1, direction: 1 }]),
    LEFT: Object.freeze([{ type: "button", index: 14 }, { type: "axis", index: 0, direction: -1 }]),
    RIGHT: Object.freeze([{ type: "button", index: 15 }, { type: "axis", index: 0, direction: 1 }]),
    A: Object.freeze([{ type: "button", index: 1 }]),
    B: Object.freeze([{ type: "button", index: 0 }]),
    L: Object.freeze([{ type: "button", index: 4 }]),
    R: Object.freeze([{ type: "button", index: 5 }]),
    START: Object.freeze([{ type: "button", index: 9 }]),
    SELECT: Object.freeze([{ type: "button", index: 8 }])
  });

  function cloneBinding(binding) {
    return { type: binding.type, index: binding.index, ...(binding.type === "axis" ? { direction: binding.direction } : {}) };
  }

  function cloneDefaults() {
    return Object.fromEntries(CONTROLS.map((control) => [control, DEFAULT_BINDINGS[control].map(cloneBinding)]));
  }

  function normalizeBinding(binding) {
    if (!binding || !Number.isInteger(Number(binding.index))) return null;
    const index = Number(binding.index);
    if (binding.type === "button" && index >= 0 && index < 128) return { type: "button", index };
    if (binding.type === "axis" && index >= 0 && index < 32) {
      return { type: "axis", index, direction: Number(binding.direction) < 0 ? -1 : 1 };
    }
    return null;
  }

  function sanitize(bindings) {
    const result = cloneDefaults();
    if (!bindings || typeof bindings !== "object") return result;
    for (const control of CONTROLS) {
      const supplied = Array.isArray(bindings[control]) ? bindings[control] : [bindings[control]];
      const valid = supplied.map(normalizeBinding).filter(Boolean).slice(0, 4);
      if (valid.length) result[control] = valid;
    }
    return result;
  }

  function bindingKey(binding) {
    return binding.type === "axis" ? `axis:${binding.index}:${binding.direction}` : `button:${binding.index}`;
  }

  function describe(binding) {
    if (!binding) return "Não definido";
    if (binding.type === "axis") return `Eixo ${binding.index} ${binding.direction < 0 ? "−" : "+"}`;
    return `Botão ${binding.index}`;
  }

  function describeAll(bindings) {
    return (bindings || []).map(describe).join(" / ") || "Não definido";
  }

  function isActive(gamepad, binding, threshold = 0.55) {
    if (!gamepad || !binding) return false;
    if (binding.type === "button") {
      const button = gamepad.buttons?.[binding.index];
      return typeof button === "number" ? button >= 0.5 : Boolean(button && (button.pressed || button.value >= 0.5));
    }
    const value = Number(gamepad.axes?.[binding.index]) || 0;
    return value * binding.direction >= threshold;
  }

  function controlIsActive(gamepad, bindings) {
    return (bindings || []).some((binding) => isActive(gamepad, binding));
  }

  function snapshot(gamepad, threshold = 0.7) {
    const state = new Map();
    if (!gamepad) return state;
    gamepad.buttons.forEach((button, index) => {
      const pressed = typeof button === "number" ? button >= 0.5 : Boolean(button.pressed || button.value >= 0.5);
      state.set(`button:${index}`, pressed);
    });
    gamepad.axes.forEach((axis, index) => {
      state.set(`axis:${index}:-1`, axis <= -threshold);
      state.set(`axis:${index}:1`, axis >= threshold);
    });
    return state;
  }

  function firstNewInput(gamepad, previousState) {
    const current = snapshot(gamepad);
    for (const [key, active] of current) {
      if (!active || previousState?.get(key)) continue;
      const [type, indexText, directionText] = key.split(":");
      return type === "button"
        ? { type, index: Number(indexText) }
        : { type, index: Number(indexText), direction: Number(directionText) < 0 ? -1 : 1 };
    }
    return null;
  }

  function findSpatialTarget(origin, candidates, direction) {
    if (!origin || !Array.isArray(candidates)) return -1;
    const vertical = direction === "UP" || direction === "DOWN";
    const sign = direction === "UP" || direction === "LEFT" ? -1 : 1;
    const originX = Number(origin.left) + Number(origin.width) / 2;
    const originY = Number(origin.top) + Number(origin.height) / 2;
    let bestIndex = -1;
    let bestScore = Infinity;

    candidates.forEach((rect, index) => {
      if (!rect) return;
      const dx = Number(rect.left) + Number(rect.width) / 2 - originX;
      const dy = Number(rect.top) + Number(rect.height) / 2 - originY;
      const primary = (vertical ? dy : dx) * sign;
      const secondary = Math.abs(vertical ? dx : dy);
      if (primary <= 2 || primary < secondary * 0.15) return;
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  GBA.GamepadBindings = Object.freeze({
    CONTROLS,
    DEFAULT_BINDINGS,
    cloneDefaults,
    sanitize,
    bindingKey,
    describe,
    describeAll,
    isActive,
    controlIsActive,
    snapshot,
    firstNewInput,
    findSpatialTarget
  });
})(window.GBA = window.GBA || {});
