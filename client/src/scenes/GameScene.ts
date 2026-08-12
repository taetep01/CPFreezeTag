import Phaser from "phaser";
import * as Colyseus from "@colyseus/sdk";
import { sendMove, sendPickItem, leaveRoom } from "../network/GameClient";

// ── Map constants ────────────────────────────────────────────────────────────
const TILE = 32;
const MAP_W = 40;
const MAP_H = 30;

// Playable 2-block gap Maze Map: 1 = wall, 0 = floor
function buildMap(): number[][] {
  const map: number[][] = [];
  for (let r = 0; r < MAP_H; r++) {
    map.push(new Array(MAP_W).fill(0));
  }

  // Border walls (1 tile)
  for (let c = 0; c < MAP_W; c++) { map[0][c] = 1; map[MAP_H - 1][c] = 1; }
  for (let r = 0; r < MAP_H; r++) { map[r][0] = 1; map[r][MAP_W - 1] = 1; }

  // 2x2 Obstacle blocks with AT LEAST 2-tile gap (64px) between all blocks
  for (let r = 3; r <= MAP_H - 4; r += 4) {
    for (let c = 3; c <= MAP_W - 4; c += 4) {
      map[r][c] = 1;
      map[r][c + 1] = 1;
      map[r + 1][c] = 1;
      map[r + 1][c + 1] = 1;
    }
  }

  // Clear 5 spacious Arenas (Plazas)
  const clearArena = (startR: number, startC: number, numR: number, numC: number) => {
    for (let r = startR; r < startR + numR; r++) {
      for (let c = startC; c < startC + numC; c++) {
        if (r > 0 && r < MAP_H - 1 && c > 0 && c < MAP_W - 1) {
          map[r][c] = 0;
        }
      }
    }
  };

  // Plazas: Center, Top-Left, Top-Right, Bottom-Left, Bottom-Right
  clearArena(10, 14, 10, 12);
  clearArena(2, 2, 7, 7);
  clearArena(2, 31, 7, 7);
  clearArena(21, 2, 7, 7);
  clearArena(21, 31, 7, 7);

  return map;
}

// ── Player sprite ────────────────────────────────────────────────────────────
interface PlayerSprite {
  body: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private room!: Colyseus.Room;
  private myId!: string;
  private myRole: string = "runner";
  private isEndGameHandled = false;

  // Sprites
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private itemSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Walls (for client-side movement blocking)
  private walls: Phaser.Geom.Rectangle[] = [];

  // Local movement state
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private myX = 0;
  private myY = 0;
  private lastSentX = -1;
  private lastSentY = -1;

  // HUD
  private timerText!: Phaser.GameObjects.Text;
  private roleText!: Phaser.GameObjects.Text;
  private itemHUDText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private heldItem: string | null = null;

  // Freeze overlay
  private freezeOverlay!: Phaser.GameObjects.Graphics;

  // Map graphics layer
  private mapLayer!: Phaser.GameObjects.Graphics;

  // Camera
  private camTarget!: Phaser.GameObjects.Arc;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { room: Colyseus.Room; playerName: string }) {
    this.room = data.room;
    this.myId = this.room.sessionId;
    this.isEndGameHandled = false;
    this.myRole = "runner";

    // Purge ALL previous GameObjects from Phaser scene display list (eliminates duplicates!)
    this.children.removeAll(true);

    this.playerSprites.clear();
    this.itemSprites.clear();
    this.walls = [];
    this.heldItem = null;
    this.myX = 0;
    this.myY = 0;
    this.lastSentX = -1;
    this.lastSentY = -1;
  }

  private cleanupSprites() {
    this.playerSprites.forEach((s) => {
      s.body?.destroy();
      s.ring?.destroy();
      s.label?.destroy();
      s.icon?.destroy();
    });
    this.playerSprites.clear();

    this.itemSprites.forEach((c) => {
      c?.destroy();
    });
    this.itemSprites.clear();
  }

  create() {
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;

    // ── Map ─────────────────────────────────────────────────────────────────
    const mapData = buildMap();
    this.mapLayer = this.add.graphics();
    this.drawMap(mapData, worldW, worldH);

    // Build wall rects for collision
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        if (mapData[r][c] === 1) {
          this.walls.push(new Phaser.Geom.Rectangle(c * TILE, r * TILE, TILE, TILE));
        }
      }
    }

    // ── Camera setup ────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.camTarget = this.add.circle(200, 200, 1, 0x000000, 0).setDepth(-1);
    this.cameras.main.startFollow(this.camTarget, true, 0.1, 0.1);

    // ── Freeze overlay ───────────────────────────────────────────────────────
    this.freezeOverlay = this.add.graphics().setScrollFactor(0).setDepth(100);

    // ── HUD ─────────────────────────────────────────────────────────────────
    this.createHUD();

    // ── Input ────────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // E key to use held item
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E).on("down", () => {
      if (this.heldItem) {
        this.room.send("use_item", { type: this.heldItem });
        this.heldItem = null;
        this.itemHUDText.setText("Item: None  [E]");
      }
    });

    // Ensure game canvas takes keyboard focus
    this.input.on("pointerdown", () => {
      window.focus();
    });

    // ── Server listeners ─────────────────────────────────────────────────────
    this.registerServerListeners();
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  private drawMap(mapData: number[][], worldW: number, worldH: number) {
    const gfx = this.mapLayer;
    // Floor
    gfx.fillStyle(0x1a2a4a, 1);
    gfx.fillRect(0, 0, worldW, worldH);
    // Grid lines (subtle)
    gfx.lineStyle(1, 0x243558, 0.5);
    for (let r = 0; r <= MAP_H; r++) gfx.lineBetween(0, r * TILE, worldW, r * TILE);
    for (let c = 0; c <= MAP_W; c++) gfx.lineBetween(c * TILE, 0, c * TILE, worldH);
    // Walls
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        if (mapData[r][c] === 1) {
          const wx = c * TILE, wy = r * TILE;
          gfx.fillStyle(0x0d47a1, 1);
          gfx.fillRect(wx + 1, wy + 1, TILE - 2, TILE - 2);
          gfx.fillStyle(0x4fc3f7, 0.25);
          gfx.fillRect(wx + 1, wy + 1, TILE - 2, 6);
          gfx.lineStyle(1, 0x4fc3f7, 0.4);
          gfx.strokeRect(wx + 1, wy + 1, TILE - 2, TILE - 2);
        }
      }
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  private createHUD() {
    const { width, height } = this.scale;

    // Top bar bg
    const hudBg = this.add.graphics().setScrollFactor(0).setDepth(90);
    hudBg.fillStyle(0x0a1a3a, 0.85);
    hudBg.fillRect(0, 0, width, 52);
    hudBg.lineStyle(1, 0x4fc3f7, 0.4);
    hudBg.lineBetween(0, 52, width, 52);

    // Timer
    this.timerText = this.add.text(width / 2, 26, "⏱ 3:00", {
      fontFamily: "Arial Black, monospace",
      fontSize: "26px",
      color: "#4fc3f7",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(95);

    // Role
    this.roleText = this.add.text(20, 26, "Role: ?", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "18px",
      color: "#ffe066",
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(95);

    // In-game Menu button
    const menuBtn = this.add.text(175, 26, "⚙️ MENU", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "14px",
      color: "#4fc3f7",
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(95).setInteractive({ useHandCursor: true });

    menuBtn.on("pointerover", () => menuBtn.setColor("#ffe066"));
    menuBtn.on("pointerout", () => menuBtn.setColor("#4fc3f7"));
    menuBtn.on("pointerdown", () => this.showInGameMenu());

    // Item HUD
    this.itemHUDText = this.add.text(width - 20, 20, "Item: Instant Auto-Use", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#b2dfdb",
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(95);

    // Item spawn rate subtext
    this.add.text(width - 20, 38, "🎁 Spawns every 8s (Max 6)", {
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      color: "#78909c",
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(95);

    // Message
    this.messageText = this.add.text(width / 2, height / 2, "", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "32px",
      color: "#ffe066",
      stroke: "#000",
      strokeThickness: 4,
      align: "center",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(110).setAlpha(0);
  }

  // ── In-Game Pause/Leave Menu ─────────────────────────────────────────────
  private showInGameMenu() {
    const { width, height } = this.scale;
    const menuObjects: Phaser.GameObjects.GameObject[] = [];

    // Backdrop
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(150);
    overlay.fillStyle(0x000000, 0.8);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    menuObjects.push(overlay);

    // Card
    const cardW = 340, cardH = 220;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;

    const card = this.add.graphics().setScrollFactor(0).setDepth(151);
    card.fillStyle(0x0d2246, 0.98);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 18);
    card.lineStyle(3, 0x4fc3f7, 0.9);
    card.strokeRoundedRect(cardX, cardY, cardW, cardH, 18);
    menuObjects.push(card);

    // Title
    const title = this.add.text(width / 2, cardY + 36, "⏸️ MATCH MENU", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "22px",
      color: "#ffe066",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(152);
    menuObjects.push(title);

    // Resume button
    const btnW = 200, btnH = 44;
    const resumeY = cardY + 95;
    const resumeGfx = this.add.graphics().setPosition(width / 2, resumeY).setScrollFactor(0).setDepth(152);
    const drawResume = (c: number) => {
      resumeGfx.clear();
      resumeGfx.fillStyle(c, 1);
      resumeGfx.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
      resumeGfx.lineStyle(2, 0xffe066, 0.8);
      resumeGfx.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
    };
    drawResume(0x1565c0);
    resumeGfx.setInteractive(new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH), Phaser.Geom.Rectangle.Contains);

    const resumeText = this.add.text(width / 2, resumeY, "▶  RESUME", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffffff",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(153);
    menuObjects.push(resumeGfx, resumeText);

    resumeGfx.on("pointerover", () => drawResume(0x1e88e5));
    resumeGfx.on("pointerout", () => drawResume(0x1565c0));
    resumeGfx.on("pointerdown", () => {
      menuObjects.forEach((obj) => obj.destroy());
    });

    // Leave Match button
    const leaveY = cardY + 155;
    const leaveGfx = this.add.graphics().setPosition(width / 2, leaveY).setScrollFactor(0).setDepth(152);
    const drawLeave = (c: number) => {
      leaveGfx.clear();
      leaveGfx.fillStyle(c, 1);
      leaveGfx.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
      leaveGfx.lineStyle(2, 0xef5350, 0.8);
      leaveGfx.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
    };
    drawLeave(0xb71c1c);
    leaveGfx.setInteractive(new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH), Phaser.Geom.Rectangle.Contains);

    const leaveText = this.add.text(width / 2, leaveY, "🚪  LEAVE MATCH", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffffff",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(153);
    menuObjects.push(leaveGfx, leaveText);

    leaveGfx.on("pointerover", () => drawLeave(0xd32f2f));
    leaveGfx.on("pointerout", () => drawLeave(0xb71c1c));
    leaveGfx.on("pointerdown", () => {
      menuObjects.forEach((obj) => obj.destroy());
      try {
        this.room.send("player_exit", {});
      } catch (e) {}
      leaveRoom();
      this.scene.start("MainMenuScene");
    });
  }

  // ── Player sprites ─────────────────────────────────────────────────────────
  private getOrCreatePlayerSprite(id: string): PlayerSprite {
    if (this.playerSprites.has(id)) return this.playerSprites.get(id)!;
    const ring = this.add.circle(0, 0, 18, 0xffffff, 0.5).setDepth(5);
    const body = this.add.circle(0, 0, 15, 0x4fc3f7, 1).setDepth(6);
    const icon = this.add.text(0, 0, "", { fontSize: "18px" }).setOrigin(0.5).setDepth(7);
    const label = this.add.text(0, -28, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#ffffff",
      stroke: "#000",
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);
    const sprite: PlayerSprite = { body, ring, label, icon };
    this.playerSprites.set(id, sprite);
    return sprite;
  }

  private updatePlayerSprite(id: string, state: any) {
    if (!id || !state) return;
    const sprite = this.getOrCreatePlayerSprite(id);
    const isMe = Boolean(id && this.myId && id === this.myId);

    // Initialize local position from server if 0
    if (isMe && (this.myX === 0 || this.myY === 0) && state.x && state.y) {
      this.myX = state.x;
      this.myY = state.y;
    }

    // Position — for local player: use myX/myY. For remote players: ALWAYS use server state.x/state.y!
    const px = (isMe && this.myX !== 0) ? this.myX : (state.x || 100);
    const py = (isMe && this.myY !== 0) ? this.myY : (state.y || 100);

    sprite.ring.setPosition(px, py);
    sprite.body.setPosition(px, py);
    sprite.icon.setPosition(px, py);
    sprite.label.setPosition(px, py - 28);

    // Role color
    const color = state.role === "chaser" ? 0xef5350 : 0x4fc3f7;
    sprite.body.setFillStyle(color);
    sprite.ring.setFillStyle(state.role === "chaser" ? 0xff8a80 : 0xb3e5fc);
    sprite.icon.setText(state.role === "chaser" ? "🔥" : "🏃");

    // Name
    const labelStr = (isMe ? "★ " : "") + (state.name || "Player");
    sprite.label.setText(labelStr).setColor(isMe ? "#ffe066" : "#e3f2fd");

    // Frozen
    if (state.frozen) {
      sprite.body.setFillStyle(0x90caf9);
      sprite.ring.setFillStyle(0xe3f2fd);
      sprite.icon.setText("🧊");
      sprite.body.setAlpha(0.7);
    } else {
      sprite.body.setAlpha(1);
    }

    // Shield ring
    sprite.ring.setVisible(!state.frozen);
    if (state.hasShield) {
      sprite.ring.setFillStyle(0xffe066).setAlpha(0.9);
    }

    // Ghost
    sprite.body.setAlpha(state.isGhost ? 0.45 : (state.frozen ? 0.7 : 1));

    // Depth: self on top
    const depth = isMe ? 10 : 5;
    sprite.body.setDepth(depth);
    sprite.ring.setDepth(depth - 1);
    sprite.label.setDepth(depth + 1);
    sprite.icon.setDepth(depth + 1);
  }

  private removePlayerSprite(id: string) {
    const s = this.playerSprites.get(id);
    if (s) {
      s.body?.destroy(); s.ring?.destroy(); s.label?.destroy();
      s.icon?.destroy();
      this.playerSprites.delete(id);
    }
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  private getItemEmoji(type: string): string {
    const map: Record<string, string> = {
      speed: "⚡", ghost: "👻", shield: "🛡️",
      heater: "🔥", banana: "🍌", blackhole: "🕳️",
    };
    return map[type] || "❓";
  }

  private getItemColor(type: string): number {
    const map: Record<string, number> = {
      speed: 0xffe066, ghost: 0xb39ddb, shield: 0x66bb6a,
      heater: 0xff7043, banana: 0xfff176, blackhole: 0x37474f,
    };
    return map[type] ?? 0xffffff;
  }

  private updateItemSprites(items: any) {
    if (!items) return;
    const activeIds = new Set<string>();

    const iterate = (item: any, id: string) => {
      if (!item || !item.active) return;
      activeIds.add(id);

      if (this.itemSprites.has(id)) return;
      const emoji = this.getItemEmoji(item.type);
      const color = this.getItemColor(item.type);
      const bg = this.add.circle(0, 0, 18, color, 0.85).setDepth(3);
      const label = this.add.text(0, 0, emoji, { fontSize: "18px" }).setOrigin(0.5).setDepth(4);
      const container = this.add.container(item.x, item.y, [bg, label]).setDepth(3);

      // Pulse animation
      this.tweens.add({
        targets: container,
        scaleX: 1.2, scaleY: 1.2,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      // Click to pick up
      bg.setInteractive(new Phaser.Geom.Circle(0, 0, 18), Phaser.Geom.Circle.Contains);
      bg.on("pointerdown", () => {
        if (this.myRole === "chaser" && item.type === "heater") return;
        sendPickItem(id);
      });

      this.itemSprites.set(id, container);
    };

    if (typeof items.forEach === "function") {
      items.forEach(iterate);
    } else if (typeof items === "object") {
      Object.entries(items).forEach(([id, item]) => iterate(item, id));
    }

    // Clean up collected items
    this.itemSprites.forEach((container, id) => {
      if (!activeIds.has(id)) {
        container.destroy();
        this.itemSprites.delete(id);
      }
    });
  }

  // ── Server listeners ────────────────────────────────────────────────────────
  private registerServerListeners() {
    const getPlayer = (players: any, id: string) => {
      if (!players) return null;
      return typeof players.get === "function" ? players.get(id) : players[id];
    };

    this.room.onStateChange((state: any) => {
      if (!state) return;

      // Check for phase ended
      if (state.phase === "ended" && state.winner) {
        this.showEndGameScreen(state.winner);
      }

      // Update timer
      if (typeof state.timeLeft === "number") {
        const mins = Math.floor(state.timeLeft / 60);
        const secs = state.timeLeft % 60;
        this.timerText.setText(`⏱ ${mins}:${String(secs).padStart(2, "0")}`);
        if (state.timeLeft <= 30) this.timerText.setColor("#ef5350");
      }

      // Update role
      const me = getPlayer(state.players, this.myId);
      if (me) {
        this.myRole = me.role || "runner";
        // Initialize position on first state packet if still 0
        if (this.myX === 0 && this.myY === 0 && me.x && me.y) {
          this.myX = me.x;
          this.myY = me.y;
        }

        this.roleText.setText(me.role === "chaser" ? "🔥 CHASER" : "🏃 RUNNER");
        this.roleText.setColor(me.role === "chaser" ? "#ef5350" : "#4fc3f7");

        // Freeze overlay
        if (me.frozen) {
          this.freezeOverlay.clear();
          this.freezeOverlay.fillStyle(0x4fc3f7, 0.25);
          this.freezeOverlay.fillRect(0, 0, this.scale.width, this.scale.height);
        } else {
          this.freezeOverlay.clear();
        }
      }

      // Update all player sprites & remove stale sprites
      const currentIds = new Set<string>();
      if (state.players) {
        const updateP = (player: any, id: string) => {
          if (player && id) {
            currentIds.add(id);
            this.updatePlayerSprite(id, player);
          }
        };
        if (typeof state.players.forEach === "function") {
          state.players.forEach(updateP);
        } else if (typeof state.players === "object") {
          Object.entries(state.players).forEach(([id, p]) => updateP(p, id));
        }
      }

      this.playerSprites.forEach((_sprite, id) => {
        if (!currentIds.has(id)) {
          this.removePlayerSprite(id);
        }
      });

      // Items
      if (state.items) {
        this.updateItemSprites(state.items);
      }

      // Follow my sprite
      if (this.myX !== 0 || this.myY !== 0) {
        this.camTarget.setPosition(this.myX, this.myY);
      }
    });

    this.room.onMessage("message", (data: { msg: string }) => {
      this.showMessage(data.msg, "#ffe066", 4000);
    });

    this.room.onMessage("player_frozen", (data: { playerId: string }) => {
      this.showFloatingMessage("🧊 FROZEN!", data.playerId);
      if (data.playerId === this.myId) this.flashScreen(0x4fc3f7);
    });

    this.room.onMessage("player_unfrozen", (data: { playerId: string }) => {
      this.showFloatingMessage("🔥 FREE!", data.playerId);
      if (data.playerId === this.myId) this.flashScreen(0xffe066);
    });

    this.room.onMessage("player_stunned", (data: { playerId: string; name?: string }) => {
      this.showFloatingMessage("💫 STUNNED!", data.playerId);
      if (data.playerId === this.myId) this.flashScreen(0xffb74d);
    });

    this.room.onMessage("chaser_tag_cooldown", (data: { chaserId: string; duration: number }) => {
      this.showFloatingMessage("⏱️ 5s TAG COOLDOWN!", data.chaserId);
    });

    this.room.onMessage("shield_break", (data: { playerId: string }) => {
      if (data.playerId === this.myId) {
        this.showMessage("🛡 Shield Broken!", "#ffe066", 2000);
      }
    });

    this.room.onMessage("player_teleported", (data: { playerId: string; x: number; y: number }) => {
      if (data.playerId === this.myId) {
        this.myX = data.x;
        this.myY = data.y;
        this.showMessage("🕳 TELEPORTED!", "#b39ddb", 2000);
        this.flashScreen(0x37474f);
      }
    });

    this.room.onMessage("game_over", (data: { winner: string; reason?: string }) => {
      this.showEndGameScreen(data.winner, data.reason);
    });

    this.room.onLeave(() => {
      if (!this.isEndGameHandled) {
        this.showEndGameScreen(this.room.state?.winner || "runner", "Match ended");
      }
    });
  }

  // ── 5-Second End Game Banner & Auto Kick ─────────────────────────────────
  private showEndGameScreen(winner: string, reason?: string) {
    if (this.isEndGameHandled) return;
    this.isEndGameHandled = true;

    // Release keyboard captures immediately so WASD keys work in HTML inputs in menus
    if (this.input?.keyboard) {
      this.input.keyboard.clearCaptures();
      this.input.keyboard.removeAllKeys(true);
    }

    const { width, height } = this.scale;

    // Triple-check player role from server state & HUD text to guarantee 100% accuracy
    const getPlayer = (players: any, id: string) => {
      if (!players) return null;
      return typeof players.get === "function" ? players.get(id) : players[id];
    };
    const me = getPlayer(this.room?.state?.players, this.myId);
    let actualRole = me?.role || this.myRole;
    if (this.roleText?.text?.includes("CHASER")) {
      actualRole = "chaser";
    }

    const won = actualRole === winner;

    // End Game Overlay Card (Depth 250)
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(250);
    overlay.fillStyle(0x000000, 0.85);
    overlay.fillRect(0, 0, width, height);

    const cardW = 480, cardH = 260;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;

    const card = this.add.graphics().setScrollFactor(0).setDepth(251);
    card.fillStyle(0x0d2246, 0.98);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 20);
    card.lineStyle(4, won ? 0xffe066 : 0xef5350, 0.95);
    card.strokeRoundedRect(cardX, cardY, cardW, cardH, 20);

    // Title Banner
    const titleText = won ? "🏆 YOU WIN!" : "💀 GAME OVER";
    const titleColor = won ? "#ffe066" : "#ef5350";
    this.add.text(width / 2, cardY + 45, titleText, {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "40px",
      color: titleColor,
      stroke: "#000033",
      strokeThickness: 5,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(252);

    // Subtext Banner
    let subtext = winner === "runner" ? "🏃 RUNNERS VICTORIOUS!" : "🔥 CHASER VICTORIOUS!";
    if (reason) subtext += `\n(${reason})`;
    this.add.text(width / 2, cardY + 118, subtext, {
      fontFamily: "Arial, sans-serif",
      fontSize: "18px",
      color: "#b3e5fc",
      align: "center",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(252);

    // 5-Second Countdown Display
    const countdownText = this.add.text(width / 2, cardY + 195, "Returning to main menu in 5s...", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      color: "#90caf9",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(252);

    let secondsLeft = 5;
    this.time.addEvent({
      delay: 1000,
      repeat: 4,
      callback: () => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          countdownText.setText(`Returning to main menu in ${secondsLeft}s...`);
        }
      },
    });

    // Kick player to MainMenuScene after 5 seconds
    this.time.delayedCall(5000, () => {
      try {
        this.room.leave();
      } catch (e) {}
      this.scene.start("MainMenuScene");
    });
  }

  // ── Update (movement & collision & item pickup) ───────────────────────────
  update() {
    const getPlayer = (players: any, id: string) => {
      if (!players) return null;
      return typeof players.get === "function" ? players.get(id) : players[id];
    };
    const myState = getPlayer(this.room.state?.players, this.myId);

    if (!myState || myState.frozen || myState.stunned || this.room.state?.phase !== "playing") return;

    // Ensure myX and myY are initialized from server
    if (this.myX === 0 || this.myY === 0) {
      this.myX = myState.x || 100;
      this.myY = myState.y || 100;
    }

    const BASE_SPEED = 3.2;
    const baseRoleMultiplier = myState.role === "chaser" ? 1.1 : 1.0;
    const speed = BASE_SPEED * (myState.speedMultiplier ?? baseRoleMultiplier);

    let dx = 0, dy = 0;
    if (this.wasd.up.isDown || this.cursors.up.isDown) dy = -1;
    else if (this.wasd.down.isDown || this.cursors.down.isDown) dy = 1;
    if (this.wasd.left.isDown || this.cursors.left.isDown) dx = -1;
    else if (this.wasd.right.isDown || this.cursors.right.isDown) dx = 1;

    if (dx !== 0 || dy !== 0) {
      // Normalize diagonal
      const len = Math.sqrt(dx * dx + dy * dy);
      let nx = this.myX + (dx / len) * speed;
      let ny = this.myY + (dy / len) * speed;

      // Clamp to world boundaries
      nx = Phaser.Math.Clamp(nx, 24, MAP_W * TILE - 24);
      ny = Phaser.Math.Clamp(ny, 24, MAP_H * TILE - 24);

      // Axis-by-axis Wall Collision (skip if ghost mode active)
      if (!myState.isGhost) {
        const radius = 14;

        // Axis X collision test & slide
        const xRect = new Phaser.Geom.Rectangle(nx - radius, this.myY - radius, radius * 2, radius * 2);
        for (const wall of this.walls) {
          if (Phaser.Geom.Rectangle.Overlaps(xRect, wall)) {
            nx = this.myX; // block horizontal movement through wall
            break;
          }
        }

        // Axis Y collision test & slide
        const yRect = new Phaser.Geom.Rectangle(nx - radius, ny - radius, radius * 2, radius * 2);
        for (const wall of this.walls) {
          if (Phaser.Geom.Rectangle.Overlaps(yRect, wall)) {
            ny = this.myY; // block vertical movement through wall
            break;
          }
        }
      }

      this.myX = nx;
      this.myY = ny;

      // Update local player sprite & camera
      const sp = this.playerSprites.get(this.myId);
      if (sp) {
        sp.body.setPosition(nx, ny);
        sp.ring.setPosition(nx, ny);
        sp.icon.setPosition(nx, ny);
        sp.label.setPosition(nx, ny - 28);
        this.camTarget.setPosition(nx, ny);
      }

      // Send position update to server
      if (Math.abs(nx - this.lastSentX) > 0.5 || Math.abs(ny - this.lastSentY) > 0.5) {
        sendMove(nx, ny);
        this.lastSentX = nx;
        this.lastSentY = ny;
      }
    }

    // Auto-pickup items when walking over them (Instant Auto-Use!)
    if (this.room.state?.items) {
      const itemsMap = this.room.state.items;
      const iterateItems = (item: any, id: string) => {
        if (!item || !item.active) return;
        // Chaser cannot pick up heater item
        if (this.myRole === "chaser" && item.type === "heater") return;

        const dx2 = this.myX - item.x;
        const dy2 = this.myY - item.y;
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < 32) {
          sendPickItem(id);
        }
      };

      if (typeof itemsMap.forEach === "function") {
        itemsMap.forEach(iterateItems);
      } else if (typeof itemsMap === "object") {
        Object.entries(itemsMap).forEach(([id, item]) => iterateItems(item, id));
      }
    }
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────
  private showMessage(text: string, color: string, duration = 2500) {
    this.messageText.setText(text).setColor(color).setAlpha(1);
    this.tweens.add({
      targets: this.messageText,
      alpha: 0,
      delay: duration - 500,
      duration: 500,
    });
  }

  private showFloatingMessage(text: string, playerId: string) {
    const sp = this.playerSprites.get(playerId);
    if (!sp) return;
    const t = this.add.text(sp.body.x, sp.body.y - 40, text, {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "16px",
      color: "#ffe066",
      stroke: "#000",
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: t,
      y: t.y - 40,
      alpha: 0,
      duration: 1500,
      onComplete: () => t.destroy(),
    });
  }

  private flashScreen(color: number) {
    const flash = this.add.graphics().setScrollFactor(0).setDepth(200);
    flash.fillStyle(color, 0.5);
    flash.fillRect(0, 0, this.scale.width, this.scale.height);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 400,
      onComplete: () => flash.destroy(),
    });
  }

  shutdown() {
    // Release keyboard captures so WASD keys work in input fields after returning to menus
    if (this.input?.keyboard) {
      this.input.keyboard.clearCaptures();
      this.input.keyboard.removeAllKeys(true);
    }
    this.cleanupSprites();
  }
}
