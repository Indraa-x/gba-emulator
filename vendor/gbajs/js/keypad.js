function GameBoyAdvanceKeypad() {
	this.KEYCODE_LEFT = 37;
	this.KEYCODE_UP = 38;
	this.KEYCODE_RIGHT = 39;
	this.KEYCODE_DOWN = 40;
	this.KEYCODE_START = 13;
	this.KEYCODE_SELECT = 220;
	this.KEYCODE_A = 90;
	this.KEYCODE_B = 88;
	this.KEYCODE_L = 65;
	this.KEYCODE_R = 83;

	this.GAMEPAD_LEFT = 14;
	this.GAMEPAD_UP = 12;
	this.GAMEPAD_RIGHT = 15;
	this.GAMEPAD_DOWN = 13;
	this.GAMEPAD_START = 9;
	this.GAMEPAD_SELECT = 8;
	this.GAMEPAD_A = 1;
	this.GAMEPAD_B = 0;
	this.GAMEPAD_L = 4;
	this.GAMEPAD_R = 5;
	this.GAMEPAD_THRESHOLD = 0.2;

	this.A = 0;
	this.B = 1;
	this.SELECT = 2;
	this.START = 3;
	this.RIGHT = 4;
	this.LEFT = 5;
	this.UP = 6;
	this.DOWN = 7;
	this.R = 8;
	this.L = 9;

	this.currentDown = 0x03FF;
	this.eatInput = false;

	this.gamepads = [];
};

GameBoyAdvanceKeypad.prototype.keyboardHandler = function(e) {
	var toggle = 0;
	switch (e.keyCode) {
	case this.KEYCODE_START:
		toggle = this.START;
		break;
	case this.KEYCODE_SELECT:
		toggle = this.SELECT;
		break;
	case this.KEYCODE_A:
		toggle = this.A;
		break;
	case this.KEYCODE_B:
		toggle = this.B;
		break;
	case this.KEYCODE_L:
		toggle = this.L;
		break;
	case this.KEYCODE_R:
		toggle = this.R;
		break;
	case this.KEYCODE_UP:
		toggle = this.UP;
		break;
	case this.KEYCODE_RIGHT:
		toggle = this.RIGHT;
		break;
	case this.KEYCODE_DOWN:
		toggle = this.DOWN;
		break;
	case this.KEYCODE_LEFT:
		toggle = this.LEFT;
		break;
	default:
		return;
	}

	toggle = 1 << toggle;
	if (e.type == "keydown") {
		this.currentDown &= ~toggle;
	} else {
		this.currentDown |= toggle;
	}

	if (this.eatInput) {
		e.preventDefault();
	}
};

GameBoyAdvanceKeypad.prototype.gamepadHandler = function(gamepad) {
	var value = 0;
	var threshold = this.GAMEPAD_THRESHOLD;
	var pressed = function(button) {
		return typeof button == 'number' ? button > threshold : !!button && (button.pressed || button.value > threshold);
	};
	if (pressed(gamepad.buttons[this.GAMEPAD_LEFT])) {
		value |= 1 << this.LEFT;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_UP])) {
		value |= 1 << this.UP;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_RIGHT])) {
		value |= 1 << this.RIGHT;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_DOWN])) {
		value |= 1 << this.DOWN;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_START])) {
		value |= 1 << this.START;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_SELECT])) {
		value |= 1 << this.SELECT;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_A])) {
		value |= 1 << this.A;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_B])) {
		value |= 1 << this.B;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_L])) {
		value |= 1 << this.L;
	}
	if (pressed(gamepad.buttons[this.GAMEPAD_R])) {
		value |= 1 << this.R;
	}

	this.currentDown = ~value & 0x3FF;
};

GameBoyAdvanceKeypad.prototype.gamepadConnectHandler = function(gamepad) {
	this.gamepads.push(gamepad);
};

GameBoyAdvanceKeypad.prototype.gamepadDisconnectHandler = function(gamepad) {
	this.gamepads = this.gamepads.filter(function(other) { return other != gamepad });
};

GameBoyAdvanceKeypad.prototype.pollGamepads = function() {
	// Advance Lab faz a leitura moderna da Gamepad API em ui.js. O polling
	// original compara objetos GamepadButton com números e zerava currentDown
	// sempre que o jogo lia KEYINPUT, anulando teclado, toque e remapeamento.
};

GameBoyAdvanceKeypad.prototype.registerHandlers = function() {
	// Advance Lab centraliza teclado, toque e gamepad em ui.js para permitir
	// remapeamento e impedir que dois handlers pressionem botões diferentes.
};
