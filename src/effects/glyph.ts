// Builds a horizontal glyph atlas (white ink on black) ordered by ink density,
// uploaded as a GL texture for the ASCII effect to sample.

// light -> dark ink ramp (index 0 = least ink)
export const ASCII_RAMP = " .:-=+*#%@";

export function buildGlyphAtlas(gl: WebGL2RenderingContext): {
  texture: WebGLTexture;
  count: number;
} {
  const ramp = ASCII_RAMP;
  const cell = 16;
  const cv = document.createElement("canvas");
  cv.width = cell * ramp.length;
  cv.height = cell;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#fff";
  ctx.font = `${cell - 2}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < ramp.length; i++) {
    ctx.fillText(ramp[i], i * cell + cell / 2, cell / 2 + 1);
  }

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // flip so glyph orientation matches the y-up source-texture convention
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture: tex, count: ramp.length };
}
