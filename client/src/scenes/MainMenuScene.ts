import Phaser from "phaser";

const ICE_BLUE = 0x4fc3f7;
// const ICE_DARK = 0x1a237e; // reserved for future use
const YELLOW = 0xffe066;
const WHITE = 0xffffff;

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  preload() {}

  create() {
    const { width, height } = this.scale;

    // ── Background gradient ──────────────────────────────────────────────────
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1b4b, 0x0d1b4b, 0x1565c0, 0x1565c0, 1);
    bg.fillRect(0, 0, width, height);

    // ── Snowflake particles ──────────────────────────────────────────────────
    for (let i = 0; i < 40; i++) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      const size = Phaser.Math.FloatBetween(1, 4);
      const alpha = Phaser.Math.FloatBetween(0.2, 0.7);
      const flake = this.add.circle(x, y, size, WHITE, alpha);
      this.tweens.add({
        targets: flake,
        y: y + Phaser.Math.Between(30, 80),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 6000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 3000),
        yoyo: false,
        onRepeat: () => {
          flake.x = Phaser.Math.Between(0, width);
          flake.y = Phaser.Math.Between(-20, 0);
          flake.alpha = alpha;
        },
      });
    }

    // ── Ice crystal decorations ──────────────────────────────────────────────
    const drawCrystal = (gfx: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, alpha: number) => {
      gfx.lineStyle(2, color, alpha);
      for (let a = 0; a < 6; a++) {
        const angle = (a * Math.PI) / 3;
        gfx.beginPath();
        gfx.moveTo(cx, cy);
        gfx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        gfx.strokePath();
        const ax = cx + Math.cos(angle) * r * 0.6;
        const ay = cy + Math.sin(angle) * r * 0.6;
        for (let b = -1; b <= 1; b += 2) {
          const ba = angle + (b * Math.PI) / 4;
          gfx.beginPath();
          gfx.moveTo(ax, ay);
          gfx.lineTo(ax + Math.cos(ba) * r * 0.25, ay + Math.sin(ba) * r * 0.25);
          gfx.strokePath();
        }
      }
    };
    const decor = this.add.graphics();
    drawCrystal(decor, 60, 80, 50, ICE_BLUE, 0.25);
    drawCrystal(decor, width - 80, height - 80, 65, ICE_BLUE, 0.2);
    drawCrystal(decor, width - 100, 100, 40, WHITE, 0.15);

    // ── Title ────────────────────────────────────────────────────────────────
    this.add.text(width / 2 + 4, height * 0.2 + 4, "CP FREEZETAG", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "72px",
      color: "#000033",
    }).setOrigin(0.5).setAlpha(0.5);

    const title = this.add.text(width / 2, height * 0.2, "CP FREEZETAG", {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "72px",
      color: "#ffe066",
      stroke: "#4fc3f7",
      strokeThickness: 6,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: title,
      scaleX: 1.04,
      scaleY: 1.04,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.add.text(width / 2, height * 0.31, "❄  Multiplayer Freeze Tag  ❄", {
      fontFamily: "Arial, sans-serif",
      fontSize: "22px",
      color: "#b3e5fc",
    }).setOrigin(0.5);

    // ── Buttons ──────────────────────────────────────────────────────────────
    this.createButton(width / 2, height * 0.5, "▶  PLAY", () => {
      this.scene.start("HostJoinScene");
    });

    this.createButton(width / 2, height * 0.63, "✕  EXIT", () => {
      window.open("", "_self", "");
      window.close();
      window.location.href = "about:blank";
    }, 0x37474f, 0x546e7a);

    // ── Version label ────────────────────────────────────────────────────────
    this.add.text(width / 2, height * 0.92, "v1.0.0  |  2-4 Players", {
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#78909c",
    }).setOrigin(0.5);
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    callback: () => void,
    colorNormal = 0x1565c0,
    colorHover = 0x1e88e5
  ) {
    const btn = this.add.graphics();
    const bw = 260, bh = 58, br = 14;

    const draw = (color: number) => {
      btn.clear();
      btn.fillStyle(color, 1);
      btn.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
      btn.lineStyle(2, YELLOW, 0.7);
      btn.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, br);
    };

    draw(colorNormal);
    btn.setPosition(x, y);
    btn.setInteractive(
      new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh),
      Phaser.Geom.Rectangle.Contains
    );

    const text = this.add.text(x, y, label, {
      fontFamily: "Arial Black, sans-serif",
      fontSize: "22px",
      color: "#ffffff",
    }).setOrigin(0.5).setDepth(1);

    btn.on("pointerover", () => {
      draw(colorHover);
      this.tweens.add({ targets: [btn, text], scaleX: 1.05, scaleY: 1.05, duration: 120 });
    });
    btn.on("pointerout", () => {
      draw(colorNormal);
      this.tweens.add({ targets: [btn, text], scaleX: 1, scaleY: 1, duration: 120 });
    });
    btn.on("pointerdown", () => {
      this.tweens.add({
        targets: [btn, text],
        scaleX: 0.96,
        scaleY: 0.96,
        duration: 80,
        yoyo: true,
        onComplete: callback,
      });
    });
  }
}
