import sharp from "sharp";

export const avatarData =
  "data:image/png;base64," +
  (
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#935f43" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
export const cosplay = {
  cosplay_character: "福尔摩斯",
  cosplay_source: "夏洛克·福尔摩斯探案集",
};
