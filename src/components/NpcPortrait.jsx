import React, { useState } from "react";
import host from "../assets/npcs/host.webp";
import singer from "../assets/npcs/singer.webp";
import attorney from "../assets/npcs/attorney.webp";
import detective from "../assets/npcs/detective.webp";
import security from "../assets/npcs/security.webp";
import scientist from "../assets/npcs/scientist.webp";

const portraits = { host, singer, attorney, detective, security, scientist };

export default function NpcPortrait({ npc, number, dossier = false }) {
  const [failed, setFailed] = useState(false);
  const src = portraits[npc.id];
  return (
    <div className={"npc-portrait" + (dossier ? " npc-dossier-portrait" : "")}>
      {src && !failed ? (
        <img
          className="npc-portrait-image"
          src={src}
          alt={`${npc.name}的人物肖像`}
          width="768"
          height="768"
          loading={dossier ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="portrait-monogram" aria-hidden="true">
          {npc.english
            .split(" ")
            .map((s) => s[0])
            .join("")}
        </span>
      )}
      {number != null && (
        <span className="portrait-number">
          {String(number).padStart(2, "0")}
        </span>
      )}
      <span className="portrait-label" aria-hidden="true">
        CHARACTER DOSSIER
      </span>
    </div>
  );
}
