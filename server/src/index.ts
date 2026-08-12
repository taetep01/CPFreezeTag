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

    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/colyseus") && !req.path.startsWith("/matchmake")) {
        return res.sendFile(path.join(clientBuildPath, "index.html"), (err) => {
          if (err) next();
        });
      }
      next();
    });
  },
});

gameServer.define("game_room", GameRoom);

gameServer.listen(PORT, "0.0.0.0", undefined, () => {
  console.log(`\n🎮 CPFreezetag Server running on 0.0.0.0:${PORT}`);
  console.log(`🖥️  Serving static client from ${clientBuildPath}`);
});
