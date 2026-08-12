import Phaser from "phaser";
import { GAME_VERSION } from "../version";
import * as Colyseus from "@colyseus/sdk";
import { sendStartGame, leaveRoom } from "../network/GameClient";

export class LobbyScene extends Phaser.Scene {
  private room!: Colyseus.Room;
  private playerName!: string;
  private isHost!: boolean;
  private playerListText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Graphics;
  private startBtnText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "LobbyScene" });
  }

  init(data: { room: Colyseus.Room; playerName: string; isHost: boolean }) {
    this.room = data.room;
    this.playerName = data.playerName;
    this.isHost = data.isHost;
  }

  create() {
    const { width, height } = this.scale;

    // Background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1b4b, 0x0d1b4b, 0x1565c0, 0x1565c0, 1);
    bg.fillRect(0, 0, width, height);

    // Leave Room button
    this.add.text(30, 24, "← Leave Room", {
      fontFamily: "Arial, sans-serif",
      fontSize: "18px",
      color: "#ef5350",
    }).setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      leaveRoom();
      this.scene.start("HostJoinScene");
    });

    // Title
    this.add.text(width / 2, 50, "❄  LOBBY  ❄", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "42px",
      color: "#ffe066",
      stroke: "#4fc3f7",
      strokeThickness: 4,
    }).setOrigin(0.5);

    // Room code panel — code is revealed HERE after clicking HOST
    // Use state.roomCode (the 6-char server-generated code) or fall back to roomId
    const roomCode = (this.room.state as any).roomCode || this.room.roomId;

    const codePanel = this.add.graphics();
    codePanel.fillStyle(0x0a2a5a, 0.9);
    codePanel.fillRoundedRect(width / 2 - 180, 95, 360, 100, 18);
    codePanel.lineStyle(3, 0xffe066, 0.95);
    codePanel.strokeRoundedRect(width / 2 - 180, 95, 360, 100, 18);

    this.add.text(width / 2, 115, "🔑  ROOM CODE  (Share with friends!)", {
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      color: "#90caf9",
    }).setOrigin(0.5);

    const codeText = this.add.text(width / 2, 158, roomCode, {
      fontFamily: "Arial Black, monospace",
      fontSize: "40px",
      color: "#ffe066",
      stroke: "#1565c0",
      strokeThickness: 3,
      letterSpacing: 8,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Click room code to copy
    codeText.on("pointerdown", () => {
      navigator.clipboard.writeText(roomCode).catch(() => {});
      codeText.setColor("#a5d6a7");
      this.time.delayedCall(1000, () => codeText.setColor("#ffe066"));
    });
    codeText.on("pointerover", () => codeText.setAlpha(0.8));
    codeText.on("pointerout", () => codeText.setAlpha(1));

    // Copy hint
    this.add.text(width / 2, 185, "Click code to copy", {
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      color: "#546e7a",
    }).setOrigin(0.5);

    // Players panel
    const playerPanel = this.add.graphics();
    playerPanel.fillStyle(0x0a1a3a, 0.85);
    playerPanel.fillRoundedRect(width / 2 - 200, 215, 400, 200, 16);
    playerPanel.lineStyle(1, 0x4fc3f7, 0.4);
    playerPanel.strokeRoundedRect(width / 2 - 200, 215, 400, 200, 16);

    this.add.text(width / 2, 235, "👥 PLAYERS", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#4fc3f7",
    }).setOrigin(0.5);

    this.playerListText = this.add.text(width / 2, 320, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "18px",
      color: "#e3f2fd",
      align: "center",
      lineSpacing: 10,
    }).setOrigin(0.5);

    // Status
    this.statusText = this.add.text(width / 2, 440, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
      color: "#4fc3f7",
    }).setOrigin(0.5);

    // Start button (host only)
    if (this.isHost) {
      this.createStartButton(width / 2, 490);
    } else {
      this.add.text(width / 2, 490, "Waiting for host to start...", {
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        color: "#78909c",
      }).setOrigin(0.5);
    }

    // Version label
    this.add.text(width / 2, height * 0.95, GAME_VERSION, {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#78909c",
    }).setOrigin(0.5);

    // ── Room state listeners ─────────────────────────────────────────────────
    this.room.onMessage("error", (data: { msg: string }) => {
      if (this.statusText) {
        this.statusText.setText("⚠ " + data.msg).setColor("#ffe066");
      }
    });

    this.room.onMessage("game_started", () => {
      this.scene.start("GameScene", { room: this.room, playerName: this.playerName });
    });

    this.room.onStateChange(() => this.refreshPlayerList());
    this.refreshPlayerList();
  }

  private refreshPlayerList() {
    if (!this.room?.state?.players || !this.playerListText) return;
    const players: string[] = [];
    const playerMap = this.room.state.players;

    const iterate = (p: any) => {
      if (!p) return;
      const isYou = p.id === this.room.sessionId;
      const isHostPlayer = p.id === this.room.state?.hostId;
      let label = `${p.name || "Player"}`;
      if (isHostPlayer) label += "  👑";
      if (isYou) label += "  (You)";
      players.push(label);
    };

    if (typeof playerMap.forEach === "function") {
      playerMap.forEach(iterate);
    } else if (typeof playerMap === "object") {
      Object.values(playerMap).forEach(iterate);
    }

    this.playerListText.setText(players.join("\n"));
  }

  private createStartButton(x: number, y: number) {
    const bw = 240, bh = 56, br = 14;
    this.startBtn = this.add.graphics().setPosition(x, y);
    const draw = (c: number) => {
      this.startBtn.clear();
      this.startBtn.fillStyle(c, 1);
      this.startBtn.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
      this.startBtn.lineStyle(2, 0xffe066, 0.8);
      this.startBtn.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
    };
    draw(0x1b5e20);
    this.startBtn.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    this.startBtnText = this.add.text(x, y, "▶  START GAME", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "22px",
      color: "#ffffff",
    }).setOrigin(0.5).setDepth(1);

    this.startBtn.on("pointerover", () => draw(0x388e3c));
    this.startBtn.on("pointerout", () => draw(0x1b5e20));
    this.startBtn.on("pointerdown", () => {
      this.tweens.add({
        targets: [this.startBtn, this.startBtnText],
        scaleX: 0.96, scaleY: 0.96, duration: 80, yoyo: true,
        onComplete: () => {
          sendStartGame();
          this.statusText.setText("Starting...").setColor("#4fc3f7");
        },
      });
    });
  }
}
