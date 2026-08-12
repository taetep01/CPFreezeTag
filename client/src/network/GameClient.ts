import * as Colyseus from "@colyseus/sdk";

const getFallbackServerUrl = () => {
  if (typeof window !== "undefined" && !import.meta.env.DEV) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return "ws://localhost:2567";
};

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || getFallbackServerUrl();

let client: Colyseus.Client | null = null;
let room: Colyseus.Room | null = null;

export function getClient(): Colyseus.Client {
  if (!client) {
    client = new Colyseus.Client(SERVER_URL);
  }
  return client;
}

export function getRoom(): Colyseus.Room | null {
  return room;
}

export async function createRoom(playerName: string): Promise<Colyseus.Room> {
  const c = getClient();
  room = await c.create("game_room", { playerName });
  return room;
}

export async function joinRoom(
  roomCode: string,
  playerName: string
): Promise<Colyseus.Room> {
  const c = getClient();
  room = await c.joinById(roomCode, { playerName });
  return room;
}

export function leaveRoom() {
  if (room) {
    try {
      room.removeAllListeners();
      room.leave();
    } catch (e) {}
    room = null;
  }
}

export function sendMove(x: number, y: number) {
  room?.send("move", { x, y });
}

export function sendStartGame() {
  room?.send("start_game", {});
}

export function sendPickItem(itemId: string) {
  room?.send("pick_item", { itemId });
}

export function sendUseItem(type: string) {
  room?.send("use_item", { type });
}

export function sendPlaceBanana(x: number, y: number) {
  room?.send("place_banana", { x, y });
}
