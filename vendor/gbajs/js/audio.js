function GameBoyAdvanceAudio() {
	window.AudioContext = window.AudioContext || window.webkitAudioContext;
	if (window.AudioContext) {
		var self = this;
		this.context = new AudioContext();
		this.bufferSize = 0;
		// 1024 frames keep the ScriptProcessor latency close to 21 ms at 48 kHz.
		// The old 4096-frame block added roughly 85 ms before our own queueing.
		this.bufferSize = 1024;
		this.maxSamples = this.bufferSize << 3;
		this.maxBufferedSamples = 1 << 23;
		this.buffers = [new Float32Array(this.maxSamples), new Float32Array(this.maxSamples)];
		this.sampleMask = this.maxSamples - 1;
		if (this.context.createScriptProcessor) {
			this.jsAudio = this.context.createScriptProcessor(this.bufferSize);
		} else {
			this.jsAudio = this.context.createJavaScriptNode(this.bufferSize);
		}
		this.jsAudio.onaudioprocess = function(e) { self.audioProcess(e) };
	} else {
		this.context = null;
	}

	this.masterEnable = true;
	this.masterVolume = 1.0;

	this.SOUND_MAX = 0x400;
	this.FIFO_MAX = 0x200;
	this.PSG_MAX = 0x080;
};

GameBoyAdvanceAudio.prototype.clear = function() {
	this.fifoA = [];
	this.fifoB = [];
	this.fifoASample = 0;
	this.fifoBSample = 0;

	this.enabled = false;
	if (this.context) {
		try {
			this.jsAudio.disconnect(this.context.destination);
		} catch (e) {
		}
	}

	this.enableChannel3 = false;
	this.enableChannel4 = false;
	this.enableChannelA = false;
	this.enableChannelB = false;
	this.enableRightChannelA = false;
	this.enableLeftChannelA = false;
	this.enableRightChannelB = false;
	this.enableLeftChannelB = false;

	this.playingChannel3 = false;
	this.playingChannel4 = false;

	this.volumeLeft = 0;
	this.volumeRight = 0;
	this.ratioChannelA = 1;
	this.ratioChannelB = 1;
	this.enabledLeft = 0;
	this.enabledRight = 0;

	this.dmaA = -1;
	this.dmaB = -1;
	this.soundTimerA = 0;
	this.soundTimerB = 0;

	this.soundRatio = 1;
	this.soundBias = 0x200;

	this.squareChannels = new Array();
	for (var i = 0; i < 2; ++i) {
		this.squareChannels[i] = {
			enabled: false,
			playing: false,
			sample: 0,
			duty: 0.5,
			increment: 0,
			step: 0,
			initialVolume: 0,
			volume: 0,
			frequency: 0,
			interval: 0,
			sweepSteps: 0,
			sweepIncrement: 0,
			sweepInterval: 0,
			doSweep: false,
			raise: 0,
			lower: 0,
			nextStep: 0,
			timed: false,
			length: 0,
			end: 0
		}
	}

	this.waveData = new Uint8Array(32);
	this.channel3Dimension = 0;
	this.channel3Bank = 0;
	this.channel3Volume = 0;
	this.channel3Interval = 0;
	this.channel3Next = 0;
	this.channel3Length = 0;
	this.channel3Timed = false;
	this.channel3End = 0;
	this.channel3Pointer =0;
	this.channel3Sample = 0;

	this.cpuFrequency = this.core.irq.FREQUENCY;

	this.channel4 = {
		sample: 0,
		lfsr: 0,
		width: 15,
		interval: this.cpuFrequency / 524288,
		increment: 0,
		step: 0,
		initialVolume: 0,
		volume: 0,
		nextStep: 0,
		timed: false,
		length: 0,
		end: 0
	};

	this.nextEvent = 0;

	this.nextSample = 0;
	this.outputPointer = 0;
	this.samplePointer = 0;
	this.bufferedSamples = 0;

	this.backup = 0;
	this.totalSamples = 0;

	this.sampleRate = 32768;
	this.sampleInterval = this.cpuFrequency / this.sampleRate;
	this.resampleRatio = 1;
	this.playbackRate = 1;
	this.preservePitch = false;
	this.lowLatencyAudio = false;
	this.pitchState = null;
	if (this.context) {
		this.resampleRatio = this.sampleRate / this.context.sampleRate;
	}

	this.writeSquareChannelFC(0, 0);
	this.writeSquareChannelFC(1, 0);
	this.writeChannel4FC(0);
};

GameBoyAdvanceAudio.prototype.freeze = function() {
	return {
		nextSample: this.nextSample
	};
};

GameBoyAdvanceAudio.prototype.defrost = function(frost) {
	this.nextSample = frost.nextSample;
};

GameBoyAdvanceAudio.prototype.pause = function(paused) {
	if (this.context) {
		if (paused) {
			try {
				this.jsAudio.disconnect(this.context.destination);
			} catch (e) {
				// Sigh
			}
		} else if (this.enabled) {
			this.jsAudio.connect(this.context.destination);
		}
	}
};

GameBoyAdvanceAudio.prototype.updateTimers = function() {
	var cycles = this.cpu.cycles;
	if (!this.enabled || (cycles < this.nextEvent && cycles < this.nextSample)) {
		return;
	}

	if (cycles >= this.nextEvent) {
		var channel = this.squareChannels[0];
		this.nextEvent = Infinity;
		if (channel.playing) {
			this.updateSquareChannel(channel, cycles);
		}

		channel = this.squareChannels[1];
		if (channel.playing) {
			this.updateSquareChannel(channel, cycles);
		}

		if (this.enableChannel3 && this.playingChannel3) {
			if (cycles >= this.channel3Next) {
				if (this.channel3Write) {
					var sample = this.waveData[this.channel3Pointer >> 1];
					this.channel3Sample = (((sample >> ((this.channel3Pointer & 1) << 2)) & 0xF) - 0x8) / 8;
					this.channel3Pointer = (this.channel3Pointer + 1);
					if (this.channel3Dimension && this.channel3Pointer >= 64) {
						this.channel3Pointer -= 64;
					} else if (!this.channel3Bank && this.channel3Pointer >= 32) {
						this.channel3Pointer -= 32;
					} else if (this.channel3Pointer >= 64) {
						this.channel3Pointer -= 32;
					}
				}
				this.channel3Next += this.channel3Interval;
				if (this.channel3Interval && this.nextEvent > this.channel3Next) {
					this.nextEvent = this.channel3Next;
				}
			}
			if (this.channel3Timed && cycles >= this.channel3End) {
				this.playingChannel3 = false;
			}
		}

		if (this.enableChannel4 && this.playingChannel4) {
			if (this.channel4.timed && cycles >= this.channel4.end) {
				this.playingChannel4 = false;
			} else {
				if (cycles >= this.channel4.next) {
					this.channel4.lfsr >>= 1;
					var sample = this.channel4.lfsr & 1;
					this.channel4.lfsr |= (((this.channel4.lfsr >> 1) & 1) ^ sample) << (this.channel4.width - 1);
					this.channel4.next += this.channel4.interval;
					this.channel4.sample = (sample - 0.5) * 2 * this.channel4.volume;
				}
				this.updateEnvelope(this.channel4, cycles);
				if (this.nextEvent > this.channel4.next) {
					this.nextEvent = this.channel4.next;
				}
				if (this.channel4.timed && this.nextEvent > this.channel4.end) {
					this.nextEvent = this.channel4.end;
				}
			}
		}
	}

	if (cycles >= this.nextSample) {
		this.sample();
		this.nextSample += this.sampleInterval;
	}

	this.nextEvent = Math.ceil(this.nextEvent);
	if ((this.nextEvent < cycles) || (this.nextSample < cycles)) {
		// STM instructions may take a long time
		this.updateTimers();
	}
};

GameBoyAdvanceAudio.prototype.writeEnable = function(value) {
	this.enabled = !!value;
	this.nextEvent = this.cpu.cycles;
	this.nextSample = this.nextEvent;
	this.updateTimers();
	this.core.irq.pollNextEvent();
	if (this.context) {
		if (value) {
			this.jsAudio.connect(this.context.destination);
		} else {
			try {
				this.jsAudio.disconnect(this.context.destination);
			} catch (e) {
			}
		}
	}
};

GameBoyAdvanceAudio.prototype.writeSoundControlLo = function(value) {
	this.masterVolumeLeft = value & 0x7;
	this.masterVolumeRight = (value >> 4) & 0x7;
	this.enabledLeft = (value >> 8) & 0xF;
	this.enabledRight = (value >> 12) & 0xF;

	this.setSquareChannelEnabled(this.squareChannels[0], (this.enabledLeft | this.enabledRight) & 0x1);
	this.setSquareChannelEnabled(this.squareChannels[1], (this.enabledLeft | this.enabledRight) & 0x2);
	this.enableChannel3 = (this.enabledLeft | this.enabledRight) & 0x4;
	this.setChannel4Enabled((this.enabledLeft | this.enabledRight) & 0x8);

	this.updateTimers();
	this.core.irq.pollNextEvent();
};

GameBoyAdvanceAudio.prototype.writeSoundControlHi = function(value) {
	switch (value & 0x0003) {
	case 0:
		this.soundRatio = 0.25;
		break;
	case 1:
		this.soundRatio = 0.50;
		break;
	case 2:
		this.soundRatio = 1;
		break;
	}
	this.ratioChannelA = (((value & 0x0004) >> 2) + 1) * 0.5;
	this.ratioChannelB = (((value & 0x0008) >> 3) + 1) * 0.5;

	this.enableRightChannelA = value & 0x0100;
	this.enableLeftChannelA = value & 0x0200;
	this.enableChannelA  = value & 0x0300;
	this.soundTimerA = value & 0x0400;
	if (value & 0x0800) {
		this.fifoA = [];
	}
	this.enableRightChannelB = value & 0x1000;
	this.enableLeftChannelB = value & 0x2000;
	this.enableChannelB  = value & 0x3000;
	this.soundTimerB = value & 0x4000;
	if (value & 0x8000) {
		this.fifoB = [];
	}
};

GameBoyAdvanceAudio.prototype.resetSquareChannel = function(channel) {
	if (channel.step) {
		channel.nextStep = this.cpu.cycles + channel.step;
	}
	if (channel.enabled && !channel.playing) {
		channel.raise = this.cpu.cycles;
		channel.lower = channel.raise + channel.duty * channel.interval;
		channel.end = this.cpu.cycles + channel.length;
		this.nextEvent = this.cpu.cycles;
	}
	channel.playing = channel.enabled;
	this.updateTimers();
	this.core.irq.pollNextEvent();
};

GameBoyAdvanceAudio.prototype.setSquareChannelEnabled = function(channel, enable) {
	if (!(channel.enabled && channel.playing) && enable) {
		channel.enabled = !!enable;
		this.updateTimers();
		this.core.irq.pollNextEvent();
	} else {
		channel.enabled = !!enable;
	}
};

GameBoyAdvanceAudio.prototype.writeSquareChannelSweep = function(channelId, value) {
	var channel = this.squareChannels[channelId];
	channel.sweepSteps = value & 0x07;
	channel.sweepIncrement = (value & 0x08) ? -1 : 1;
	channel.sweepInterval = ((value >> 4) & 0x7) * this.cpuFrequency / 128;
	channel.doSweep = !!channel.sweepInterval;
	channel.nextSweep = this.cpu.cycles + channel.sweepInterval;
	this.resetSquareChannel(channel);
};

GameBoyAdvanceAudio.prototype.writeSquareChannelDLE = function(channelId, value) {
	var channel = this.squareChannels[channelId];
	var duty = (value >> 6) & 0x3;
	switch (duty) {
	case 0:
		channel.duty = 0.125;
		break;
	case 1:
		channel.duty = 0.25;
		break;
	case 2:
		channel.duty = 0.5;
		break;
	case 3:
		channel.duty = 0.75;
		break;
	}
	this.writeChannelLE(channel, value);
	this.resetSquareChannel(channel);
};

GameBoyAdvanceAudio.prototype.writeSquareChannelFC = function(channelId, value) {
	var channel = this.squareChannels[channelId];
	var frequency = value & 2047;
	channel.frequency = frequency;
	channel.interval = this.cpuFrequency * (2048 - frequency) / 131072;
	channel.timed = !!(value & 0x4000);

	if (value & 0x8000) {
		this.resetSquareChannel(channel);
		channel.volume = channel.initialVolume;
	}
};

GameBoyAdvanceAudio.prototype.updateSquareChannel = function(channel, cycles) {
	if (channel.timed && cycles >= channel.end) {
		channel.playing = false;
		return;
	}

	if (channel.doSweep && cycles >= channel.nextSweep) {
		channel.frequency += channel.sweepIncrement * (channel.frequency >> channel.sweepSteps);
		if (channel.frequency < 0) {
			channel.frequency = 0;
		} else if (channel.frequency > 2047) {
			channel.frequency = 2047;
			channel.playing = false;
			return;
		}
		channel.interval = this.cpuFrequency * (2048 - channel.frequency) / 131072;
		channel.nextSweep += channel.sweepInterval;
	}

	if (cycles >= channel.raise) {
		channel.sample = channel.volume;
		channel.lower = channel.raise + channel.duty * channel.interval;
		channel.raise += channel.interval;
	} else if (cycles >= channel.lower) {
		channel.sample = -channel.volume;
		channel.lower += channel.interval;
	}

	this.updateEnvelope(channel, cycles);

	if (this.nextEvent > channel.raise) {
		this.nextEvent = channel.raise;
	}
	if (this.nextEvent > channel.lower) {
		this.nextEvent = channel.lower;
	}
	if (channel.timed && this.nextEvent > channel.end) {
		this.nextEvent = channel.end;
	}
	if (channel.doSweep && this.nextEvent > channel.nextSweep) {
		this.nextEvent = channel.nextSweep;
	}
};

GameBoyAdvanceAudio.prototype.writeChannel3Lo = function(value) {
	this.channel3Dimension = value & 0x20;
	this.channel3Bank = value & 0x40;
	var enable = value & 0x80;
	if (!this.channel3Write && enable) {
		this.channel3Write = enable;
		this.resetChannel3();
	} else {
		this.channel3Write = enable;
	}
};

GameBoyAdvanceAudio.prototype.writeChannel3Hi = function(value) {
	this.channel3Length = this.cpuFrequency * (0x100 - (value & 0xFF)) / 256;
	var volume = (value >> 13) & 0x7;
	switch (volume) {
	case 0:
		this.channel3Volume = 0;
		break;
	case 1:
		this.channel3Volume = 1;
		break;
	case 2:
		this.channel3Volume = 0.5;
		break;
	case 3:
		this.channel3Volume = 0.25;
		break;
	default:
		this.channel3Volume = 0.75;
	}
};

GameBoyAdvanceAudio.prototype.writeChannel3X = function(value) {
	this.channel3Interval = this.cpuFrequency * (2048 - (value & 0x7FF)) / 2097152;
	this.channel3Timed = !!(value & 0x4000);
	if (this.channel3Write) {
		this.resetChannel3();
	}
};

GameBoyAdvanceAudio.prototype.resetChannel3 = function() {
	this.channel3Next = this.cpu.cycles;
	this.nextEvent = this.channel3Next;
	this.channel3End = this.cpu.cycles + this.channel3Length;
	this.playingChannel3 = this.channel3Write;
	this.updateTimers();
	this.core.irq.pollNextEvent();
};

GameBoyAdvanceAudio.prototype.writeWaveData = function(offset, data, width) {
	if (!this.channel3Bank) {
		offset += 16;
	}
	if (width == 2) {
		this.waveData[offset] = data & 0xFF;
		data >>= 8;
		++offset;
	}
	this.waveData[offset] = data & 0xFF;
};

GameBoyAdvanceAudio.prototype.setChannel4Enabled = function(enable) {
	if (!this.enableChannel4 && enable) {
		this.channel4.next = this.cpu.cycles;
		this.channel4.end = this.cpu.cycles + this.channel4.length;
		this.enableChannel4 = true;
		this.playingChannel4 = true;
		this.nextEvent = this.cpu.cycles;
		this.updateEnvelope(this.channel4);
		this.updateTimers();
		this.core.irq.pollNextEvent();
	} else {
		this.enableChannel4 = enable;
	}
}

GameBoyAdvanceAudio.prototype.writeChannel4LE = function(value) {
	this.writeChannelLE(this.channel4, value);
	this.resetChannel4();
};

GameBoyAdvanceAudio.prototype.writeChannel4FC = function(value) {
	this.channel4.timed = !!(value & 0x4000);

	var r = value & 0x7;
	if (!r) {
		r = 0.5;
	}
	var s = (value >> 4) & 0xF;
	var interval = this.cpuFrequency * (r * (2 << s)) / 524288;
	if (interval != this.channel4.interval) {
		this.channel4.interval = interval;
		this.resetChannel4();
	}

	var width = (value & 0x8) ? 7 : 15;
	if (width != this.channel4.width) {
		this.channel4.width = width;
		this.resetChannel4();
	}

	if (value & 0x8000) {
		this.resetChannel4();
	}
};

GameBoyAdvanceAudio.prototype.resetChannel4 = function() {
	if (this.channel4.width == 15) {
		this.channel4.lfsr = 0x4000;
	} else {
		this.channel4.lfsr = 0x40;
	}
	this.channel4.volume = this.channel4.initialVolume;
	if (this.channel4.step) {
		this.channel4.nextStep = this.cpu.cycles + this.channel4.step;
	}
	this.channel4.end = this.cpu.cycles + this.channel4.length;
	this.channel4.next = this.cpu.cycles;
	this.nextEvent = this.channel4.next;

	this.playingChannel4 = this.enableChannel4;
	this.updateTimers();
	this.core.irq.pollNextEvent();
};

GameBoyAdvanceAudio.prototype.writeChannelLE = function(channel, value) {
	channel.length = this.cpuFrequency * ((0x40 - (value & 0x3F)) / 256);

	if (value & 0x0800) {
		channel.increment = 1 / 16;
	} else {
		channel.increment = -1 / 16;
	}
	channel.initialVolume = ((value >> 12) & 0xF) / 16;

	channel.step = this.cpuFrequency * (((value >> 8) & 0x7) / 64);
};

GameBoyAdvanceAudio.prototype.updateEnvelope = function(channel, cycles) {
	if (channel.step) {
		if (cycles >= channel.nextStep) {
			channel.volume += channel.increment;
			if (channel.volume > 1) {
				channel.volume = 1;
			} else if (channel.volume < 0) {
				channel.volume = 0;
			}
			channel.nextStep += channel.step;
		}

		if (this.nextEvent > channel.nextStep) {
			this.nextEvent = channel.nextStep;
		}
	}
};

GameBoyAdvanceAudio.prototype.appendToFifoA = function(value) {
	var b;
	if (this.fifoA.length > 28) {
		this.fifoA = this.fifoA.slice(-28);
	}
	for (var i = 0; i < 4; ++i) {
		b = (value & 0xFF) << 24;
		value >>= 8;
		this.fifoA.push(b / 0x80000000);
	}
};

GameBoyAdvanceAudio.prototype.appendToFifoB = function(value) {
	var b;
	if (this.fifoB.length > 28) {
		this.fifoB = this.fifoB.slice(-28);
	}
	for (var i = 0; i < 4; ++i) {
		b = (value & 0xFF) << 24;
		value >>= 8;
		this.fifoB.push(b / 0x80000000);
	}
};

GameBoyAdvanceAudio.prototype.sampleFifoA = function() {
	if (this.fifoA.length <= 16) {
		var dma = this.core.irq.dma[this.dmaA];
		dma.nextCount = 4;
		this.core.mmu.serviceDma(this.dmaA, dma);
	}
	// An empty FIFO must produce silence, never undefined/NaN.  Some games
	// briefly outrun DMA while changing tracks or loading a new scene.
	this.fifoASample = this.fifoA.length ? this.fifoA.shift() : 0;
};

GameBoyAdvanceAudio.prototype.sampleFifoB = function() {
	if (this.fifoB.length <= 16) {
		var dma = this.core.irq.dma[this.dmaB];
		dma.nextCount = 4;
		this.core.mmu.serviceDma(this.dmaB, dma);
	}
	this.fifoBSample = this.fifoB.length ? this.fifoB.shift() : 0;
};

GameBoyAdvanceAudio.prototype.scheduleFIFODma = function(number, info) {
	switch (info.dest) {
	case this.cpu.mmu.BASE_IO | this.cpu.irq.io.FIFO_A_LO:
		// FIXME: is this needed or a hack?
		info.dstControl = 2;
		this.dmaA = number;
		break;
	case this.cpu.mmu.BASE_IO | this.cpu.irq.io.FIFO_B_LO:
		info.dstControl = 2;
		this.dmaB = number;
		break;
	default:
		this.core.WARN('Tried to schedule FIFO DMA for non-FIFO destination');
		break;
	}
};

GameBoyAdvanceAudio.prototype.sample = function() {
	var sampleLeft = 0;
	var sampleRight = 0;
	var sample;
	var channel;
	var muted = this.channelMuted || [];

	channel = this.squareChannels[0];
	if (channel.playing && !muted[0]) {
		sample = channel.sample * this.soundRatio * this.PSG_MAX;
		if (this.enabledLeft & 0x1) {
			sampleLeft += sample;
		}
		if (this.enabledRight & 0x1) {
			sampleRight += sample;
		}
	}

	channel = this.squareChannels[1];
	if (channel.playing && !muted[1]) {
		sample = channel.sample * this.soundRatio * this.PSG_MAX;
		if (this.enabledLeft & 0x2) {
			sampleLeft += sample;
		}
		if (this.enabledRight & 0x2) {
			sampleRight += sample;
		}
	}

	if (this.playingChannel3 && !muted[2]) {
		sample = this.channel3Sample * this.soundRatio * this.channel3Volume * this.PSG_MAX;
		if (this.enabledLeft & 0x4) {
			sampleLeft += sample;
		}
		if (this.enabledRight & 0x4) {
			sampleRight += sample;
		}
	}

	if (this.playingChannel4 && !muted[3]) {
		sample = this.channel4.sample * this.soundRatio * this.PSG_MAX;
		if (this.enabledLeft & 0x8) {
			sampleLeft += sample;
		}
		if (this.enabledRight & 0x8) {
			sampleRight += sample;
		}
	}

	if (this.enableChannelA && !muted[4]) {
		sample = this.fifoASample * this.FIFO_MAX * this.ratioChannelA;
		if (this.enableLeftChannelA) {
			sampleLeft += sample;
		}
		if (this.enableRightChannelA) {
			sampleRight += sample;
		}
	}

	if (this.enableChannelB && !muted[5]) {
		sample = this.fifoBSample * this.FIFO_MAX * this.ratioChannelB;
		if (this.enableLeftChannelB) {
			sampleLeft += sample;
		}
		if (this.enableRightChannelB) {
			sampleRight += sample;
		}
	}

	var samplePointer = this.samplePointer;
	sampleLeft *= this.masterVolume / this.SOUND_MAX;
	sampleLeft = Math.max(Math.min(sampleLeft, 1), -1);
	sampleRight *= this.masterVolume / this.SOUND_MAX;
	sampleRight = Math.max(Math.min(sampleRight, 1), -1);
	if (this.buffers) {
		if (this.bufferedSamples >= this.maxSamples - 2) {
			this.growAudioBuffer();
			samplePointer = this.samplePointer;
		}
		this.buffers[0][samplePointer] = sampleLeft;
		this.buffers[1][samplePointer] = sampleRight;
		this.bufferedSamples = Math.min(this.maxSamples - 1, this.bufferedSamples + 1);
	}
	this.samplePointer = (samplePointer + 1) & this.sampleMask;
};

GameBoyAdvanceAudio.prototype.growAudioBuffer = function() {
	var oldMax = this.maxSamples;
	var limit = this.maxBufferedSamples || (1 << 23);
	if (oldMax >= limit) {
		var drop = Math.min(this.bufferSize || 4096, Math.max(0, Math.floor(this.bufferedSamples) - 2));
		this.outputPointer = (this.outputPointer + drop) % oldMax;
		this.bufferedSamples = Math.max(0, this.bufferedSamples - drop);
		this.pitchState = null;
		return;
	}

	var newMax = Math.min(oldMax * 2, limit);
	var newBuffers = [new Float32Array(newMax), new Float32Array(newMax)];
	var firstSample = Math.floor(this.outputPointer);
	var fraction = this.outputPointer - firstSample;
	var buffered = Math.min(oldMax - 2, Math.max(0, Number(this.bufferedSamples) || 0));
	var count = Math.ceil(buffered);
	for (var index = 0; index < count; ++index) {
		var oldIndex = (firstSample + index) & this.sampleMask;
		newBuffers[0][index] = this.buffers[0][oldIndex];
		newBuffers[1][index] = this.buffers[1][oldIndex];
	}

	this.buffers = newBuffers;
	this.maxSamples = newMax;
	this.sampleMask = newMax - 1;
	this.outputPointer = fraction;
	this.samplePointer = count;
	this.bufferedSamples = buffered;
	this.pitchState = null;
};

GameBoyAdvanceAudio.prototype.audioProcess = function(audioProcessingEvent) {
	var left = audioProcessingEvent.outputBuffer.getChannelData(0);
	var right = audioProcessingEvent.outputBuffer.getChannelData(1);
	if (this.masterEnable) {
		if (this.lowLatencyAudio) {
			this.audioProcessLowLatency(left, right);
			++this.totalSamples;
			return;
		}
		if (this.preservePitch && this.playbackRate > 1) {
			this.audioProcessPitchPreserved(left, right);
			++this.totalSamples;
			return;
		}
		var i;
		var o = this.outputPointer;
		var available = Number(this.bufferedSamples) || 0;
		for (i = 0; i < this.bufferSize; ++i, o += this.resampleRatio) {
			if (o >= this.maxSamples) {
				o -= this.maxSamples;
			}
			if (available <= 2 || (o | 0) == this.samplePointer) {
				++this.backup;
				break;
			}
			left[i] = this.buffers[0][o | 0];
			right[i] = this.buffers[1][o | 0];
			available -= this.resampleRatio;
		}
		for (; i < this.bufferSize; ++i) {
			left[i] = 0;
			right[i] = 0;
		}
		this.outputPointer = o;
		this.bufferedSamples = Math.max(0, available);
		++this.totalSamples;
	} else {
		for (i = 0; i < this.bufferSize; ++i) {
			left[i] = 0;
			right[i] = 0;
		}
	}
};

GameBoyAdvanceAudio.prototype.audioProcessLowLatency = function(left, right) {
	var ratio = Number(this.resampleRatio) || 1;
	var maxSamples = this.maxSamples;
	var mask = this.sampleMask;
	var buffers = this.buffers;
	var available = Number(this.bufferedSamples) || 0;
	var targetSamples = Math.max(this.bufferSize || left.length, Math.ceil(left.length * ratio) + 128);
	var expectedDrop = Math.max(0, available - targetSamples);
	var fadeFrames = 128;
	var searchSamples = 64;
	var correlationFrames = 32;
	var startPointer = this.outputPointer;

	var wrap = function(pointer) {
		while (pointer >= maxSamples) pointer -= maxSamples;
		while (pointer < 0) pointer += maxSamples;
		return pointer;
	};
	var read = function(channel, pointer) {
		pointer = wrap(pointer);
		var whole = pointer | 0;
		var fraction = pointer - whole;
		var first = buffers[channel][whole & mask];
		var second = buffers[channel][(whole + 1) & mask];
		return first + (second - first) * fraction;
	};

	var actualDrop = expectedDrop;
	if (expectedDrop > searchSamples && available - expectedDrop > left.length * ratio + searchSamples + 2) {
		var bestShift = 0;
		var bestScore = -Infinity;
		for (var shift = -searchSamples; shift <= searchSamples; shift += 4) {
			var candidate = startPointer + expectedDrop + shift;
			var dot = 0;
			var energyOld = 0;
			var energyNew = 0;
			for (var frame = 0; frame < correlationFrames; ++frame) {
				var offset = frame * ratio;
				var oldSample = (read(0, startPointer + offset) + read(1, startPointer + offset)) * .5;
				var newSample = (read(0, candidate + offset) + read(1, candidate + offset)) * .5;
				dot += oldSample * newSample;
				energyOld += oldSample * oldSample;
				energyNew += newSample * newSample;
			}
			var energy = Math.sqrt(energyOld * energyNew);
				var score = energy > 1e-8 ? dot / energy : -Math.abs(shift) / searchSamples;
			if (score > bestScore) {
				bestScore = score;
				bestShift = shift;
			}
		}
		actualDrop = Math.max(0, expectedDrop + bestShift);
	}

	var livePointer = wrap(startPointer + actualDrop);
	var outputIndex = 0;
	for (; outputIndex < left.length; ++outputIndex) {
		var consumed = actualDrop + outputIndex * ratio;
		if (available - consumed <= 2) {
			++this.backup;
			break;
		}
		var newPointer = livePointer + outputIndex * ratio;
		var sampleLeft = read(0, newPointer);
		var sampleRight = read(1, newPointer);
		if (actualDrop > 0 && outputIndex < fadeFrames) {
			var oldPointer = startPointer + outputIndex * ratio;
			var blend = outputIndex / fadeFrames;
			sampleLeft = read(0, oldPointer) * (1 - blend) + sampleLeft * blend;
			sampleRight = read(1, oldPointer) * (1 - blend) + sampleRight * blend;
		}
		left[outputIndex] = sampleLeft;
		right[outputIndex] = sampleRight;
	}

	var totalConsumed = actualDrop + outputIndex * ratio;
	this.outputPointer = wrap(startPointer + totalConsumed);
	this.bufferedSamples = Math.max(0, available - totalConsumed);
	for (; outputIndex < left.length; ++outputIndex) {
		left[outputIndex] = 0;
		right[outputIndex] = 0;
	}
};

GameBoyAdvanceAudio.prototype.audioProcessPitchPreserved = function(left, right) {
	var ratio = Number(this.resampleRatio) || 1;
	var playbackRate = Math.max(1, Number(this.playbackRate) || 1);
	var grainFrames = 512;
	var fadeFrames = 96;
	var searchSamples = 72;
	var correlationFrames = 32;
	var maxSamples = this.maxSamples;
	var mask = this.sampleMask;
	var buffers = this.buffers;
	var available = Math.max(0, Number(this.bufferedSamples) || 0);
	var state = this.pitchState;

	var wrap = function(pointer) {
		while (pointer >= maxSamples) pointer -= maxSamples;
		while (pointer < 0) pointer += maxSamples;
		return pointer;
	};
	var read = function(channel, pointer) {
		pointer = wrap(pointer);
		var whole = pointer | 0;
		var fraction = pointer - whole;
		var first = buffers[channel][whole & mask];
		var second = buffers[channel][(whole + 1) & mask];
		return first + (second - first) * fraction;
	};
	var forwardDistance = function(from, to) {
		var distance = wrap(to) - wrap(from);
		if (distance < 0) distance += maxSamples;
		return distance;
	};

	if (!state || state.ratio !== ratio || state.playbackRate !== playbackRate) {
		state = {
			ratio: ratio,
			playbackRate: playbackRate,
			grainOffset: 0,
			oldPointer: this.outputPointer,
			newPointer: this.outputPointer,
			skipped: false,
			grainConsumption: 0,
			primed: false
		};
		this.pitchState = state;
	}

	var chooseAlignedPointer = function(oldPointer, expectedPointer) {
		var bestPointer = expectedPointer;
		var bestScore = -Infinity;
		for (var shift = -searchSamples; shift <= searchSamples; shift += 4) {
			var candidate = wrap(expectedPointer + shift);
			var dot = 0;
			var energyOld = 0;
			var energyNew = 0;
			for (var frame = 0; frame < correlationFrames; ++frame) {
				var offset = frame * ratio;
				var oldSample = (read(0, oldPointer + offset) + read(1, oldPointer + offset)) * .5;
				var newSample = (read(0, candidate + offset) + read(1, candidate + offset)) * .5;
				dot += oldSample * newSample;
				energyOld += oldSample * oldSample;
				energyNew += newSample * newSample;
			}
			var energy = Math.sqrt(energyOld * energyNew);
			var score = energy > 1e-8 ? dot / energy : -Math.abs(shift) / searchSamples;
			if (score > bestScore) {
				bestScore = score;
				bestPointer = candidate;
			}
		}
		return bestPointer;
	};

	var outputIndex = 0;
	// Keep one short reserve so requestAnimationFrame jitter cannot empty the
	// queue between two audio callbacks.  This replaces the old strategy that
	// chopped a large piece of sound out once per callback.
	var callbackConsumption = left.length * ratio * playbackRate;
	var startupSamples = Math.ceil(callbackConsumption + searchSamples + 512);
	if (!state.primed) {
		if (available < startupSamples) {
			for (; outputIndex < left.length; ++outputIndex) {
				left[outputIndex] = 0;
				right[outputIndex] = 0;
			}
			return;
		}
		state.primed = true;
	}
	while (outputIndex < left.length) {
		if (state.grainOffset === 0) {
			state.oldPointer = wrap(this.outputPointer);
			var recoverySkip = Math.max(0, available - startupSamples);
			var desiredSkip = grainFrames * ratio * (playbackRate - 1) + recoverySkip;
			var required = desiredSkip + searchSamples + grainFrames * ratio + 2;
			if (available > required) {
				var expected = wrap(state.oldPointer + desiredSkip);
				state.newPointer = chooseAlignedPointer(state.oldPointer, expected);
				state.skipped = true;
			} else {
				state.newPointer = state.oldPointer;
				state.skipped = false;
			}
			state.grainConsumption = forwardDistance(state.oldPointer, state.newPointer) + grainFrames * ratio;
		}

		var newReadPointer = wrap(state.newPointer + state.grainOffset * ratio);
		if (available - forwardDistance(this.outputPointer, newReadPointer) <= 2) {
			++this.backup;
			break;
		}

		var sampleLeft = read(0, newReadPointer);
		var sampleRight = read(1, newReadPointer);
		if (state.skipped && state.grainOffset < fadeFrames) {
			var oldReadPointer = wrap(state.oldPointer + state.grainOffset * ratio);
			var blend = state.grainOffset / fadeFrames;
			sampleLeft = read(0, oldReadPointer) * (1 - blend) + sampleLeft * blend;
			sampleRight = read(1, oldReadPointer) * (1 - blend) + sampleRight * blend;
		}

		left[outputIndex] = sampleLeft;
		right[outputIndex] = sampleRight;
		++outputIndex;
		++state.grainOffset;
		if (state.grainOffset >= grainFrames) {
			this.outputPointer = wrap(state.newPointer + grainFrames * ratio);
			available = Math.max(0, available - state.grainConsumption);
			this.bufferedSamples = available;
			state.grainOffset = 0;
		}
	}

	this.bufferedSamples = available;
	for (; outputIndex < left.length; ++outputIndex) {
		left[outputIndex] = 0;
		right[outputIndex] = 0;
	}
};
