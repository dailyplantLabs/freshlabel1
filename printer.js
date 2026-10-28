/**
 * FreshLabel — Multi-Mode Thermal Label Printer Controller
 * Supports:
 * 1) OS System / Driver Printer (USB, Wi-Fi, Windows/Mac Bluetooth, AirPrint)
 * 2) Web Bluetooth (BLE) ESC/POS Thermal Label Printers
 * 3) Web Serial (USB Cable Direct ESC/POS Printers)
 */

class LabelPrinterManager {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.serialPort = null;
    this.serialWriter = null;
    this.isConnected = false;
    this.connectionType = 'NONE'; // 'NONE' | 'SYSTEM' | 'BLE' | 'USB'
    this.connectedName = '';
    this.autoSystemPrint = false;
    this.paperSize = '58x40'; // '40x30' | '50x30' | '58x40'
    this.soundEnabled = true;
    this.onStatusChange = null;
  }

  notifyStatus() {
    if (this.onStatusChange) {
      this.onStatusChange(this.isConnected, this.connectedName, this.connectionType);
    }
  }

  /**
   * Synthesize a realistic 2-stage thermal printer motor & cutter chirp using Web Audio API
   */
  playPrintSound() {
    if (!this.soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(190, now);
      osc1.frequency.linearRampToValueAtTime(245, now + 0.16);
      gain1.gain.setValueAtTime(0.06, now);
      gain1.gain.exponentialRampToValueAtTime(0.008, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.18);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, now + 0.19);
      osc2.frequency.setValueAtTime(1760, now + 0.25);
      gain2.gain.setValueAtTime(0.09, now + 0.19);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.19);
      osc2.stop(now + 0.35);
    } catch (_) {}
  }

  /**
   * Mode 1: Connect OS Default / System Printer (Works on file://, https://, Windows, Mac, Android, iOS)
   */
  connectSystemPrinter(customPrinterName = '기본 라벨 프린터') {
    this.isConnected = true;
    this.connectionType = 'SYSTEM';
    this.connectedName = customPrinterName || '기본 라벨 프린터';
    this.autoSystemPrint = true;
    this.notifyStatus();
    return this.connectedName;
  }

  /**
   * Mode 2: Connect Bluetooth Low Energy (BLE) Thermal Label Printer via Web Bluetooth API
   */
  async connectBluetooth() {
    if (!navigator.bluetooth) {
      if (window.location.protocol === 'file:') {
        throw new Error(
          '현재 바탕화면 파일(file://)로 열려 있어 브라우저 보안상 블루투스 직접 검색이 제한됩니다. 아래 [1. 기본 프린터(윈도우/블루투스 드라이버) 연결] 버튼을 누르시면 즉시 연결됩니다!'
        );
      }
      throw new Error('이 브라우저는 Web Bluetooth를 지원하지 않습니다. [1. 기본 프린터 연결]을 사용해 주세요.');
    }

    const PRINT_SERVICES = [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '0000ffe0-0000-1000-8000-00805f9b34fb',
      '0000fee7-0000-1000-8000-00805f9b34fb'
    ];

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINT_SERVICES
    });

    device.addEventListener('gattserverdisconnected', () => {
      if (this.connectionType === 'BLE') {
        this.isConnected = false;
        this.connectionType = 'NONE';
        this.connectedName = '';
        this.characteristic = null;
        this.notifyStatus();
      }
    });

    const server = await device.gatt.connect();
    let foundChar = null;

    for (const serviceUuid of PRINT_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const chars = await service.getCharacteristics();
        foundChar = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        if (foundChar) break;
      } catch (_) {}
    }

    this.device = device;
    this.characteristic = foundChar;
    this.isConnected = true;
    this.connectionType = 'BLE';
    this.connectedName = device.name || 'BLE 블루투스 프린터';
    this.notifyStatus();

    return this.connectedName;
  }

  /**
   * Mode 3: Connect USB Serial Thermal Printer (POS / PC USB Port)
   */
  async connectUsbSerial() {
    if (!navigator.serial) {
      throw new Error(
        '현재 환경에서는 USB 포트 직접 제어 대신 [1. 기본 프린터 연결]을 사용하시면 모든 USB 프린터로 바로 출력됩니다.'
      );
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    this.serialPort = port;
    this.serialWriter = port.writable ? port.writable.getWriter() : null;
    this.isConnected = true;
    this.connectionType = 'USB';
    this.connectedName = 'USB 라벨 프린터';
    this.notifyStatus();
    return this.connectedName;
  }

  async disconnectAll() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (_) {}
    }
    if (this.serialWriter) {
      try {
        this.serialWriter.releaseLock();
      } catch (_) {}
      this.serialWriter = null;
    }
    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch (_) {}
      this.serialPort = null;
    }
    this.isConnected = false;
    this.connectionType = 'NONE';
    this.connectedName = '';
    this.characteristic = null;
    this.autoSystemPrint = false;
    this.notifyStatus();
  }

  buildEscPosBytes(labelData) {
    const encoder = new TextEncoder();
    const expiresClean = String(labelData.expiresAtFormatted || '')
      .replace(/\s*\(당일포함[^)]*\)/g, '')
      .replace(/\s*까지$/g, '')
      .trim();

    const textLines = [
      '\x1B\x40',
      '================================\n',
      `[ 자 재 명 ] ${labelData.itemName || ''}\n`,
      `[ 시작일시 ] ${labelData.openedAtFormatted || ''}\n`,
      `[ 소비기한 ] ${expiresClean}\n`,
      `[ 유통기한 ] ${labelData.originalExpiryFormatted || '-'}\n`,
      `[ 담 당 자 ] ${labelData.manager || '매장관리자'} (${labelData.code || '#L-100'})\n`,
      '================================\n\n\n'
    ].join('');
    return encoder.encode(textLines);
  }

  /**
   * Print label payload to connected BLE / USB / System printer
   */
  async printLabel(labelData) {
    this.playPrintSound();

    // 1. BLE Printer
    if (this.isConnected && this.connectionType === 'BLE' && this.characteristic) {
      try {
        const bytes = this.buildEscPosBytes(labelData);
        const chunkSize = 100;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.slice(i, i + chunkSize);
          if (this.characteristic.writeValueWithoutResponse) {
            await this.characteristic.writeValueWithoutResponse(chunk);
          } else {
            await this.characteristic.writeValue(chunk);
          }
        }
        return { mode: 'bluetooth', deviceName: this.connectedName };
      } catch (err) {
        console.warn('BLE 전송 실패:', err);
      }
    }

    // 2. USB Serial Printer
    if (this.isConnected && this.connectionType === 'USB' && this.serialWriter) {
      try {
        const bytes = this.buildEscPosBytes(labelData);
        await this.serialWriter.write(bytes);
        return { mode: 'usb', deviceName: this.connectedName };
      } catch (err) {
        console.warn('USB 전송 실패:', err);
      }
    }

    // 3. OS System / Driver Printer (USB, Wi-Fi, OS Bluetooth, AirPrint)
    if (this.autoSystemPrint || (this.isConnected && this.connectionType === 'SYSTEM')) {
      setTimeout(() => {
        window.print();
      }, 120);
      return { mode: 'system_print', deviceName: this.connectedName || '시스템 라벨 프린터' };
    }

    return { mode: 'virtual', deviceName: '화면 라벨 미리보기 (즉시 갱신됨)' };
  }
}

window.LabelPrinterManager = LabelPrinterManager;
