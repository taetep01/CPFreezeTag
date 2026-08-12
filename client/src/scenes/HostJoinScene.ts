import Phaser from "phaser";
import { createRoom, joinRoom } from "../network/GameClient";

export class HostJoinScene extends Phaser.Scene {
  private nameInput!: HTMLInputElement;
  private codeInput!: HTMLInputElement;
  private statusText!: Phaser.GameObjects.Text;
  private hostBtn!: Phaser.GameObjects.Graphics;
  private hostBtnText!: Phaser.GameObjects.Text;
  private inputElements: HTMLElement[] = [];

  constructor() {
    super({ key: "HostJoinScene" });
  }

  create() {
    const { width, height } = this.scale;

    // Clear keyboard captures so WASD keys can be typed into HTML inputs
    if (this.input?.keyboard) {
      this.input.keyboard.clearCaptures();
      this.input.keyboard.removeAllKeys(true);
    }

    // Background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1b4b, 0x0d1b4b, 0x1565c0, 0x1565c0, 1);
    bg.fillRect(0, 0, width, height);

    // Back button
    this.add.text(30, 24, "← Back", {
      fontFamily: "Arial, sans-serif",
      fontSize: "18px",
      color: "#4fc3f7",
    }).setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      this.clearInputs();
      this.scene.start("MainMenuScene");
    });

    // Title
    this.add.text(width / 2, 56, "❄  JOIN OR HOST  ❄", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "36px",
      color: "#ffe066",
      stroke: "#4fc3f7",
      strokeThickness: 4,
    }).setOrigin(0.5);

    // Panel background
    const panelW = 500, panelH = 370;
    const panelX = (width - panelW) / 2;
    const panelY = 100;
    const panel = this.add.graphics();
    panel.fillStyle(0x0a1a3a, 0.85);
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 20);
    panel.lineStyle(2, 0x4fc3f7, 0.6);
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 20);

    // ── "Your Name" label — centered ─────────────────────────────────────────
    this.add.text(width / 2, panelY + 28, "Your Name", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#b3e5fc",
    }).setOrigin(0.5);

    // Name input — directly under label
    this.nameInput = this.createHTMLInput(width / 2, panelY + 62, 300, "Enter your name...", "text");

    // Horizontal divider
    const divider = this.add.graphics();
    divider.lineStyle(1, 0x4fc3f7, 0.3);
    divider.lineBetween(panelX + 30, panelY + 104, panelX + panelW - 30, panelY + 104);

    // ── Columns setup ────────────────────────────────────────────────────────
    const hostCX = panelX + panelW / 4;       // Left column center (~200)
    const joinCX = panelX + (panelW * 3) / 4;   // Right column center (~700)
    const buttonY = panelY + 230;              // EXACT SAME HEIGHT for both buttons!

    // ── HOST section (left column) ───────────────────────────────────────────
    this.add.text(hostCX, panelY + 128, "HOST A GAME", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffe066",
    }).setOrigin(0.5);

    this.add.text(hostCX, panelY + 165, "Code shown in lobby\nafter hosting", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#78909c",
      align: "center",
    }).setOrigin(0.5);

    this.createHostButton(hostCX, buttonY);

    // ── JOIN section (right column) ──────────────────────────────────────────
    this.add.text(joinCX, panelY + 128, "JOIN A GAME", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffe066",
    }).setOrigin(0.5);

    // Room code input — centered above JOIN button
    this.codeInput = this.createHTMLInput(joinCX, panelY + 165, 170, "Room Code", "text");

    this.createButton(joinCX, buttonY, "➤  JOIN", 0x006064, 0x00838f, () => this.doJoin());

    // Vertical divider
    divider.lineBetween(panelX + panelW / 2, panelY + 110, panelX + panelW / 2, panelY + panelH - 20);

    // Status
    this.statusText = this.add.text(width / 2, panelY + panelH + 18, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#ef9a9a",
    }).setOrigin(0.5);
  }

  // ── Canvas-aware HTML input ──────────────────────────────────────────────────
  private createHTMLInput(
    cx: number,
    cy: number,
    w: number,
    placeholder: string,
    type: string
  ): HTMLInputElement {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx     = rect.width  / this.scale.width;
    const sy     = rect.height / this.scale.height;

    const screenCX = rect.left + cx * sx;
    const screenCY = rect.top  + cy * sy;
    const screenW  = w  * sx;
    const screenH  = 34 * sy;
    const fontSize = Math.round(15 * Math.min(sx, sy));
    const radius   = Math.round(8  * Math.min(sx, sy));

    const input = document.createElement("input");
    input.type        = type;
    input.placeholder = placeholder;
    input.maxLength   = 20;
    input.style.cssText = `
      position: fixed;
      left: ${screenCX - screenW / 2}px;
      top:  ${screenCY - screenH / 2}px;
      width: ${screenW}px;
      height: ${screenH}px;
      background: #0d2550;
      border: 2px solid #4fc3f7;
      border-radius: ${radius}px;
      color: #ffe066;
      font-size: ${fontSize}px;
      text-align: center;
      outline: none;
      padding: 0 6px;
      box-sizing: border-box;
      font-family: Arial, sans-serif;
      letter-spacing: 2px;
      text-transform: uppercase;
      z-index: 10;
      display: block;
    `;
    document.body.appendChild(input);
    this.inputElements.push(input);
    return input;
  }

  // ── Pop-up Modal ─────────────────────────────────────────────────────────────
  private showPopup(title: string, message: string) {
    const { width, height } = this.scale;
    const modalObjects: Phaser.GameObjects.GameObject[] = [];

    // Hide DOM HTML inputs while popup is visible so they don't bleed over the modal
    this.inputElements.forEach((el) => {
      el.style.display = "none";
    });

    // Backdrop overlay
    const overlay = this.add.graphics().setDepth(100);
    overlay.fillStyle(0x000000, 0.78);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    modalObjects.push(overlay);

    // Modal Card
    const cardW = 420, cardH = 220;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;

    const card = this.add.graphics().setDepth(101);
    card.fillStyle(0x0d2246, 0.98);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 18);
    card.lineStyle(3, 0xffe066, 0.95);
    card.strokeRoundedRect(cardX, cardY, cardW, cardH, 18);
    modalObjects.push(card);

    // Title
    const titleText = this.add.text(width / 2, cardY + 36, title, {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "22px",
      color: "#ffe066",
      stroke: "#0d1b4b",
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(102);
    modalObjects.push(titleText);

    // Message
    const msgText = this.add.text(width / 2, cardY + 90, message, {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#e3f2fd",
      align: "center",
      wordWrap: { width: cardW - 40 },
    }).setOrigin(0.5).setDepth(102);
    modalObjects.push(msgText);

    // Close button
    const btnW = 140, btnH = 44, btnY = cardY + 160;
    const btnGfx = this.add.graphics().setPosition(width / 2, btnY).setDepth(102);
    const drawBtn = (c: number) => {
      btnGfx.clear();
      btnGfx.fillStyle(c, 1);
      btnGfx.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
      btnGfx.lineStyle(2, 0xffe066, 0.8);
      btnGfx.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
    };
    drawBtn(0x1565c0);
    btnGfx.setInteractive(new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH), Phaser.Geom.Rectangle.Contains);

    const btnText = this.add.text(width / 2, btnY, "✕ CLOSE", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffffff",
    }).setOrigin(0.5).setDepth(103);

    modalObjects.push(btnGfx, btnText);

    btnGfx.on("pointerover", () => drawBtn(0x1e88e5));
    btnGfx.on("pointerout", () => drawBtn(0x1565c0));
    btnGfx.on("pointerdown", () => {
      modalObjects.forEach((obj) => obj.destroy());
      // Restore DOM HTML inputs when popup is closed
      this.inputElements.forEach((el) => {
        el.style.display = "block";
      });
    });
  }

  private createHostButton(x: number, y: number) {
    const bw = 160, bh = 48, br = 12;
    const colorNormal = 0x1565c0, colorHover = 0x1e88e5;
    this.hostBtn = this.add.graphics().setPosition(x, y);
    const draw = (c: number) => {
      this.hostBtn.clear();
      this.hostBtn.fillStyle(c, 1);
      this.hostBtn.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
      this.hostBtn.lineStyle(2, 0xffe066, 0.5);
      this.hostBtn.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
    };
    draw(colorNormal);
    this.hostBtn.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    this.hostBtnText = this.add.text(x, y, "🏠  HOST", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "17px",
      color: "#ffffff",
    }).setOrigin(0.5).setDepth(1);

    this.hostBtn.on("pointerover", () => { draw(colorHover); });
    this.hostBtn.on("pointerout",  () => { draw(colorNormal); });
    this.hostBtn.on("pointerdown", () => {
      this.tweens.add({
        targets: [this.hostBtn, this.hostBtnText],
        scaleX: 0.95, scaleY: 0.95, duration: 80, yoyo: true,
        onComplete: () => this.doHost(),
      });
    });
  }

  private createButton(
    x: number, y: number,
    label: string,
    colorNormal: number, colorHover: number,
    callback: () => void
  ) {
    const bw = 160, bh = 48, br = 12;
    const btn = this.add.graphics().setPosition(x, y);
    const draw = (c: number) => {
      btn.clear();
      btn.fillStyle(c, 1);
      btn.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
      btn.lineStyle(2, 0xffe066, 0.5);
      btn.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
    };
    draw(colorNormal);
    btn.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    const text = this.add.text(x, y, label, {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "17px",
      color: "#ffffff",
    }).setOrigin(0.5).setDepth(1);

    btn.on("pointerover", () => { draw(colorHover); });
    btn.on("pointerout",  () => { draw(colorNormal); });
    btn.on("pointerdown", () => {
      this.tweens.add({ targets: [btn, text], scaleX: 0.95, scaleY: 0.95, duration: 80, yoyo: true, onComplete: callback });
    });
  }

  private async doHost() {
    const rawName = (this.nameInput.value || "").trim();
    if (!rawName) {
      this.showPopup("⚠️ NAME REQUIRED", "Please enter your name before hosting a room!");
      return;
    }
    const name = rawName.toUpperCase().slice(0, 12);
    this.statusText.setText("Creating room...").setColor("#4fc3f7");
    try {
      const room = await createRoom(name);
      this.clearInputs();
      this.scene.start("LobbyScene", { room, playerName: name, isHost: true });
    } catch (e) {
      this.statusText.setText("❌ Failed to connect. Is the server running?").setColor("#ef9a9a");
      console.error("Host error:", e);
    }
  }

  private async doJoin() {
    const rawName = (this.nameInput.value || "").trim();
    if (!rawName) {
      this.showPopup("⚠️ NAME REQUIRED", "Please enter your name before joining a room!");
      return;
    }
    const name = rawName.toUpperCase().slice(0, 12);
    const code = (this.codeInput.value || "").trim().toUpperCase();
    if (!code) {
      this.showPopup("⚠️ ROOM CODE REQUIRED", "Please enter a Room Code to join!");
      return;
    }
    this.statusText.setText("Joining room...").setColor("#4fc3f7");
    try {
      const room = await joinRoom(code, name);
      this.clearInputs();
      this.scene.start("LobbyScene", { room, playerName: name, isHost: false });
    } catch (e) {
      this.statusText.setText("❌ Room not found or full.").setColor("#ef9a9a");
      console.error("Join error:", e);
    }
  }

  private clearInputs() {
    this.inputElements.forEach((el) => el.remove());
    this.inputElements = [];
  }

  shutdown() {
    this.clearInputs();
  }
}
