import "reflect-metadata";
import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

// ── Item types ──────────────────────────────────────────────────────────────
export type ItemType =
  | "speed"
  | "ghost"
  | "shield"
  | "heater"
  | "banana"
  | "blackhole";

// ── Map spawn points ────────────────────────────────────────────────────────
const TILE_SIZE = 32;
const MAP_W = 40;
const MAP_H = 30;

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

function getValidSpawns(): { x: number; y: number }[] {
  const map = buildMap();
  const valid: { x: number; y: number }[] = [];
  for (let r = 1; r < MAP_H - 1; r++) {
    for (let c = 1; c < MAP_W - 1; c++) {
      if (map[r][c] === 0) {
        valid.push({
          x: c * TILE_SIZE + TILE_SIZE / 2,
          y: r * TILE_SIZE + TILE_SIZE / 2,
        });
      }
    }
  }
  return valid;
}

const SPAWN_POSITIONS = getValidSpawns();

function randomSpawn() {
  return SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)];
}

// ── Schemas ──────────────────────────────────────────────────────────────────
export class ItemState extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") active: boolean = true;
}

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Player";
  @type("number") x: number = 100;
  @type("number") y: number = 100;
  @type("string") role: string = "runner"; // "chaser" | "runner"
  @type("boolean") frozen: boolean = false;
  @type("boolean") hasShield: boolean = false;
  @type("number") speedMultiplier: number = 1;
  @type("boolean") isGhost: boolean = false;
  @type("boolean") stunned: boolean = false;
  @type("boolean") connected: boolean = true;
  @type("number") freezeCount: number = 0;
}

export class GameState extends Schema {
  @type("string") phase: string = "lobby";
  @type("number") timeLeft: number = 180;
  @type("string") winner: string = "";
  @type("string") roomCode: string = "";
  @type("string") hostId: string = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: ItemState }) items = new MapSchema<ItemState>();
}

// Colyseus 0.17 room options interface
interface GameRoomOptions {
  state: GameState;
  metadata: { roomCode: string };
}

// ── GameRoom ─────────────────────────────────────────────────────────────────
export class GameRoom extends Room<GameRoomOptions> {
  maxClients = 4;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private itemSpawnInterval: ReturnType<typeof setInterval> | null = null;
  private itemCounter = 0;

  onCreate(options: Record<string, unknown>) {
    const initialState = new GameState();
    const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0,O,I,1)
    const generateCode = () =>
      Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
    const code = (options["roomCode"] as string) || generateCode();
    this.roomId = code;
    initialState.roomCode = code;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).setState(initialState);

    this.onMessage("start_game", (client: Client) => {
      if (client.sessionId !== this.state.roomCode) {
        // check against hostId instead
      }
      const gs = this.getGameState();
      if (client.sessionId !== gs.hostId) return;
      if (this.clients.length < 2) {
        client.send("error", { msg: "Need at least 2 players to start." });
        return;
      }
      this.startGame();
    });

    this.onMessage("move", (client: Client, data: { x: number; y: number }) => {
      const gs = this.getGameState();
      const player = gs.players.get(client.sessionId);
      if (!player || gs.phase !== "playing") return;
      if (player.frozen || player.stunned) return;
      player.x = data.x;
      player.y = data.y;
      this.checkTagCollisions(gs, player);
    });

    this.onMessage("use_item", (client: Client, data: { type: string }) => {
      this.handleItemUse(client.sessionId, data.type as ItemType);
    });

    this.onMessage("pick_item", (client: Client, data: { itemId: string }) => {
      const gs = this.getGameState();
      const player = gs.players.get(client.sessionId);
      const item = gs.items.get(data.itemId);
      if (player && item && item.active && gs.phase === "playing") {
        // Prevent Chaser from picking up heater item
        if (player.role === "chaser" && item.type === "heater") {
          return;
        }

        item.active = false;
        gs.items.delete(data.itemId);
        this.applyItemEffect(gs, player, item.type as ItemType);
      }
    });

    this.onMessage("place_banana", (_client: Client, data: { x: number; y: number }) => {
      this.spawnItem("banana", data.x, data.y);
    });

    this.onMessage("player_exit", (client: Client) => {
      const gs = this.getGameState();
      const player = gs.players.get(client.sessionId);
      if (!player) return;

      const leavingRole = player.role;
      const leavingName = player.name;
      gs.players.delete(client.sessionId);
      console.log(`[GameRoom] ${leavingName} (${leavingRole}) exited match.`);

      if (gs.phase === "playing") {
        if (leavingRole === "chaser") {
          this.endGame(gs, "runner", `${leavingName} left match`);
        } else {
          const remainingRunners: PlayerState[] = [];
          gs.players.forEach((p: PlayerState) => {
            if (p.role === "runner") remainingRunners.push(p);
          });
          if (remainingRunners.length === 0 || remainingRunners.every((r) => r.frozen)) {
            this.endGame(gs, "chaser", `${leavingName} left match`);
          }
        }
      }
    });

    console.log(`[GameRoom] Room created: ${code}`);
  }

  onJoin(client: Client, options: Record<string, unknown>) {
    const gs = this.getGameState();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = String(options["playerName"] || `Player${this.clients.length}`);
    const sp = randomSpawn();
    player.x = sp.x;
    player.y = sp.y;

    if (this.clients.length === 1) {
      gs.hostId = client.sessionId;
    }
    gs.players.set(client.sessionId, player);
    console.log(`[GameRoom] ${player.name} joined. Total: ${this.clients.length}`);
  }

  onLeave(client: Client, _code?: number) {
    const gs = this.getGameState();
    const player = gs.players.get(client.sessionId);
    if (!player) return;

    const leavingRole = player.role;
    const leavingName = player.name;
    gs.players.delete(client.sessionId);
    console.log(`[GameRoom] ${leavingName} (${leavingRole}) left the room.`);

    if (gs.phase === "playing") {
      if (leavingRole === "chaser") {
        // If CHASER exits -> RUNNERS WIN!
        this.endGame(gs, "runner", `Chaser ${leavingName} left`);
      } else {
        // If RUNNER exits -> Check remaining runners
        const remainingRunners: PlayerState[] = [];
        gs.players.forEach((p: PlayerState) => {
          if (p.role === "runner") remainingRunners.push(p);
        });

        if (remainingRunners.length === 0 || remainingRunners.every((r) => r.frozen)) {
          // If no active runners left -> CHASER WINS!
          this.endGame(gs, "chaser", `Runner ${leavingName} left`);
        }
      }
    }
  }

  onDispose() {
    this.stopTimers();
    console.log(`[GameRoom] Room disposed.`);
  }

  // ── Helper to get typed state ─────────────────────────────────────────────
  private getGameState(): GameState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).state as GameState;
  }

  // ── Game Flow ─────────────────────────────────────────────────────────────
  private startGame() {
    const gs = this.getGameState();
    gs.phase = "playing";
    gs.timeLeft = 180;
    this.assignRoles(gs);
    this.placePlayersOnMap(gs);
    this.startTimer(gs);
    this.startItemSpawner(gs);
    this.broadcast("game_started", { roomCode: gs.roomCode });
  }

  private assignRoles(gs: GameState) {
    const playerIds = Array.from(gs.players.keys());
    const chaserIndex = Math.floor(Math.random() * playerIds.length);
    playerIds.forEach((id, i) => {
      const p = gs.players.get(id)!;
      p.role = i === chaserIndex ? "chaser" : "runner";
      p.frozen = false;
      p.hasShield = false;
      // Chaser is 1.1x faster than Runners. All Runners (including Host) have 1.0x speed.
      p.speedMultiplier = p.role === "chaser" ? 1.1 : 1.0;
      p.isGhost = false;
      p.stunned = false;
    });
  }

  private placePlayersOnMap(gs: GameState) {
    gs.players.forEach((player: PlayerState) => {
      const sp = randomSpawn();
      player.x = sp.x;
      player.y = sp.y;
    });
  }

  private startTimer(gs: GameState) {
    this.timerInterval = setInterval(() => {
      if (gs.phase !== "playing") { this.stopTimers(); return; }
      gs.timeLeft -= 1;
      if (gs.timeLeft <= 0) this.endGame(gs, "runner", "Time expired");
    }, 1000);
  }

  private startItemSpawner(gs: GameState) {
    this.itemSpawnInterval = setInterval(() => {
      if (gs.phase !== "playing") return;
      if (gs.items.size < 6) {
        const types: ItemType[] = ["speed", "ghost", "shield", "heater", "banana", "blackhole"];
        const t = types[Math.floor(Math.random() * types.length)];
        const sp = randomSpawn();
        this.spawnItem(t, sp.x, sp.y);
      }
    }, 8000);
  }

  private ensureValidPosition(player: PlayerState) {
    const map = buildMap();
    const c = Math.floor(player.x / TILE_SIZE);
    const r = Math.floor(player.y / TILE_SIZE);

    if (r <= 0 || r >= MAP_H - 1 || c <= 0 || c >= MAP_W - 1 || map[r][c] === 1) {
      const validSpawns = getValidSpawns();
      let nearest = validSpawns[0];
      let minD = Infinity;
      for (const sp of validSpawns) {
        const d = (sp.x - player.x) ** 2 + (sp.y - player.y) ** 2;
        if (d < minD) {
          minD = d;
          nearest = sp;
        }
      }
      player.x = nearest.x;
      player.y = nearest.y;
      this.broadcast("player_teleported", { playerId: player.id, x: nearest.x, y: nearest.y });
      this.broadcast("message", { msg: `👻 ${player.name} emerged safely out of wall!` });
    }
  }

  private spawnItem(itemType: string, x: number, y: number) {
    const gs = this.getGameState();
    const item = new ItemState();
    item.id = `item_${++this.itemCounter}`;
    item.type = itemType;
    item.x = x;
    item.y = y;
    item.active = true;
    gs.items.set(item.id, item);
  }

  private stopTimers() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.itemSpawnInterval) { clearInterval(this.itemSpawnInterval); this.itemSpawnInterval = null; }
  }

  // ── Collision & Tag ───────────────────────────────────────────────────────
  private chaserCooldowns: Map<string, number> = new Map();

  private checkTagCollisions(gs: GameState, movedPlayer: PlayerState) {
    const TAG_DISTANCE = 40;
    const now = Date.now();

    gs.players.forEach((other: PlayerState) => {
      if (other.id === movedPlayer.id) return;
      const dx = movedPlayer.x - other.x;
      const dy = movedPlayer.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > TAG_DISTANCE) return;

      // Identify runner and chaser regardless of who initiated movement
      const runner = movedPlayer.role === "runner" ? movedPlayer : (other.role === "runner" ? other : null);
      const chaser = movedPlayer.role === "chaser" ? movedPlayer : (other.role === "chaser" ? other : null);

      if (runner && chaser && !runner.frozen) {
        // Enforce 5-second touch cooldown for Chaser
        const lastTag = this.chaserCooldowns.get(chaser.id) || 0;
        if (now - lastTag < 5000) {
          return; // Chaser is currently on tag cooldown!
        }

        if (runner.hasShield) {
          runner.hasShield = false;
          this.chaserCooldowns.set(chaser.id, now);
          this.broadcast("shield_break", { playerId: runner.id });
          this.broadcast("chaser_tag_cooldown", { chaserId: chaser.id, duration: 5000 });
        } else {
          runner.frozen = true;
          runner.freezeCount += 1;
          this.chaserCooldowns.set(chaser.id, now);
          this.broadcast("chaser_tag_cooldown", { chaserId: chaser.id, duration: 5000 });
          this.broadcast("player_frozen", { playerId: runner.id });
          this.broadcast("message", { msg: `⏱️ Chaser on 5s TAG COOLDOWN!` });
          this.checkEndCondition(gs);
        }
      }

      // Unfreeze condition: active runner touches frozen runner
      if (movedPlayer.role === "runner" && !movedPlayer.frozen && other.role === "runner" && other.frozen) {
        other.frozen = false;
        this.broadcast("player_unfrozen", { playerId: other.id });
      }
    });
  }

  private checkEndCondition(gs: GameState) {
    const runners: PlayerState[] = [];
    gs.players.forEach((p: PlayerState) => { if (p.role === "runner") runners.push(p); });
    if (runners.length === 0 || runners.every((r) => r.frozen)) {
      this.endGame(gs, "chaser", "All runners tagged or left");
    }
  }

  private endGame(gs: GameState, winner: "chaser" | "runner", reason: string = "") {
    if (gs.phase === "ended") return;
    gs.phase = "ended";
    gs.winner = winner;
    this.stopTimers();
    this.broadcast("game_over", { winner, reason });
    console.log(`[GameRoom] Game over. Winner: ${winner}. Reason: ${reason}`);
    setTimeout(() => {
      try {
        this.disconnect();
      } catch (e) {}
    }, 6000);
  }

  // ── Item Effects ──────────────────────────────────────────────────────────
  private applyItemEffect(gs: GameState, player: PlayerState, itemType: ItemType) {
    switch (itemType) {
      case "speed": {
        const baseSpeed = player.role === "chaser" ? 1.1 : 1.0;
        player.speedMultiplier = baseSpeed * 1.6;
        this.broadcast("message", { msg: `⚡ ${player.name} activated SPEED BOOST!` });
        setTimeout(() => { player.speedMultiplier = baseSpeed; }, 6000);
        break;
      }

      case "ghost":
        player.isGhost = true;
        this.broadcast("message", { msg: `👻 ${player.name} activated GHOST MODE!` });
        setTimeout(() => {
          player.isGhost = false;
          this.ensureValidPosition(player);
        }, 5000);
        break;

      case "shield":
        player.hasShield = true;
        this.broadcast("message", { msg: `🛡️ ${player.name} activated SHIELD!` });
        setTimeout(() => { player.hasShield = false; }, 10000);
        break;

      case "heater": {
        if (player.role === "chaser") return; // Chasers cannot pick up heater!
        const frozenRunners: string[] = [];
        gs.players.forEach((p: PlayerState, id: string) => {
          if (p.role === "runner" && p.frozen) frozenRunners.push(id);
        });
        if (frozenRunners.length > 0) {
          const pick = frozenRunners[Math.floor(Math.random() * frozenRunners.length)];
          const target = gs.players.get(pick);
          if (target) {
            target.frozen = false;
            this.broadcast("player_unfrozen", { playerId: pick });
            this.broadcast("message", { msg: `🔥 ${player.name} used Heater & unfroze ${target.name}!` });
          }
        } else {
          this.broadcast("message", { msg: `🔥 ${player.name} used Heater!` });
        }
        break;
      }

      case "banana": {
        if (player.role === "chaser") {
          // Chaser picked up banana -> Stun nearest Runner!
          let nearestRunner: PlayerState | null = null;
          let minDistance = Infinity;
          gs.players.forEach((p: PlayerState) => {
            if (p.role === "runner" && !p.frozen) {
              const dx = p.x - player.x;
              const dy = p.y - player.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDistance) {
                minDistance = dist;
                nearestRunner = p;
              }
            }
          });

          if (nearestRunner) {
            const target = nearestRunner as PlayerState;
            target.stunned = true;
            this.broadcast("player_stunned", { playerId: target.id, name: target.name });
            this.broadcast("message", { msg: `🍌 ${player.name} threw Banana Peel at ${target.name}! STUNNED!` });
            setTimeout(() => {
              target.stunned = false;
            }, 3000);
          }
        } else {
          // Runner picked up banana -> Stun Chaser!
          gs.players.forEach((p: PlayerState) => {
            if (p.role === "chaser") {
              p.stunned = true;
              this.broadcast("player_stunned", { playerId: p.id, name: p.name });
              this.broadcast("message", { msg: `🍌 ${player.name} threw Banana Peel at Chaser ${p.name}! STUNNED!` });
              setTimeout(() => {
                p.stunned = false;
              }, 3000);
            }
          });
        }
        break;
      }

      case "blackhole": {
        let nearest: PlayerState | null = null;
        let nearestDist = Infinity;
        gs.players.forEach((p: PlayerState) => {
          if (p.id === player.id) return;
          const dx = p.x - player.x;
          const dy = p.y - player.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        });
        if (nearest) {
          const sp = randomSpawn();
          (nearest as PlayerState).x = sp.x;
          (nearest as PlayerState).y = sp.y;
          this.broadcast("player_teleported", {
            playerId: (nearest as PlayerState).id,
            x: sp.x,
            y: sp.y,
          });
          this.broadcast("message", { msg: `🕳️ ${player.name} used Blackhole on ${(nearest as PlayerState).name}!` });
        }
        break;
      }
    }
  }

  private handleItemUse(sessionId: string, itemType: ItemType) {
    const gs = this.getGameState();
    const player = gs.players.get(sessionId);
    if (!player || gs.phase !== "playing") return;
    this.applyItemEffect(gs, player, itemType);
  }
}
