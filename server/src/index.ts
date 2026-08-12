import "reflect-metadata";
import path from "path";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom";

const PORT = Number(process.env.PORT) || 2567;
const clientBuildPath = path.join(__dirname, "../../client/dist");

const gameServer = new Server({
  express: (app) => {
    app.use(cors());
    app.use(express.json());

    app.use(express.static(clientBuildPath));

    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/colyseus") || req.path.startsWith("/matchmake")) {
        return next();
      }
      res.sendFile(path.join(clientBuildPath, "index.html"), (err) => {
        if (err) next();
      });
    });
  },
});

gameServer.define("game_room", GameRoom);

gameServer.listen(PORT, undefined, undefined, () => {
  console.log(`\n🎮 CPFreezetag Server running on port ${PORT}`);
  console.log(`🖥️  Serving static client from ${clientBuildPath}`);
});
