import Phaser from "phaser";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { HostJoinScene } from "./scenes/HostJoinScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#0d1b4b",
  scene: [MainMenuScene, HostJoinScene, LobbyScene, GameScene],
  render: {
    antialias: true,
    antialiasGL: true,
    pixelArt: false,
    roundPixels: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  parent: "app",
};

const game = new Phaser.Game(config);
export default game;
