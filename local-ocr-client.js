(() => {
  const endpoint = 'http://127.0.0.1:11437/api/ocr';
  const healthEndpoint = 'http://127.0.0.1:11437/health';
  let healthyPromise = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function readBridgeRuntimeStatus() {
    try {
      return await window.__vetorizadorBridge?.assistRuntime?.getStatus?.();
    } catch {
      return null;
    }
  }

  async function waitUntilHealthy(maxChecks = 45) {
    for (let check = 0; check < maxChecks; check += 1) {
      const runtime = await readBridgeRuntimeStatus();
      if (runtime?.ocrAssistHealthy) {
        return true;
      }

      if (runtime?.ocrAssistLastError) {
        throw new Error(`PaddleOCR local indisponível: ${runtime.ocrAssistLastError}`);
      }

      if (runtime?.ocrAssistEnabled) {
        await sleep(1000);
        continue;
      }

      try {
        const response = await fetch(healthEndpoint, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.ok) return true;
      } catch {
        // O Electron pode estar relançando o processo Python neste intervalo.
      }
      await sleep(1000);
    }
    return false;
  }

  function ensureHealthy(maxChecks = 60) {
    if (!healthyPromise) {
      healthyPromise = waitUntilHealthy(maxChecks)
        .then((ok) => {
          if (!ok) {
            throw new Error('PaddleOCR local ainda não ficou saudável.');
          }
          return true;
        })
        .catch((error) => {
          healthyPromise = null;
          throw error;
        });
    }
    return healthyPromise;
  }

  async function recognizeImages(images, attempts = 90) {
    await ensureHealthy(75);

    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images })
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.ok) return payload;
        lastError = new Error(payload?.error || `PaddleOCR local indisponível (HTTP ${response.status}).`);
      } catch (error) {
        lastError = error;
      }

      healthyPromise = null;
      await ensureHealthy(15);
    }
    throw lastError || new Error('PaddleOCR local indisponível.');
  }

  async function recognizeCanvas(canvas) {
    const maxDimension = 2200;
    const maxPixels = 6000000;
    const sourceWidth = Number(canvas.width) || 0;
    const sourceHeight = Number(canvas.height) || 0;
    const resizeRatio = Math.min(
      1,
      maxDimension / Math.max(sourceWidth, sourceHeight, 1),
      Math.sqrt(maxPixels / Math.max(sourceWidth * sourceHeight, 1))
    );
    let imageCanvas = canvas;
    if (resizeRatio < 1) {
      imageCanvas = document.createElement('canvas');
      imageCanvas.width = Math.max(1, Math.round(sourceWidth * resizeRatio));
      imageCanvas.height = Math.max(1, Math.round(sourceHeight * resizeRatio));
      const context = imageCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
      context.drawImage(canvas, 0, 0, imageCanvas.width, imageCanvas.height);
    }
    const payload = await recognizeImages([imageCanvas.toDataURL('image/jpeg', 0.88)]);
    return {
      text: String(payload.rawText || ''),
      lines: Array.isArray(payload.lines) ? payload.lines : [],
      confidence: payload.meanConfidence ?? null,
      provider: payload.provider || 'paddleocr-local'
    };
  }

  window.VetorizadorLocalOcr = Object.freeze({ endpoint, recognizeCanvas, recognizeImages, waitUntilHealthy: ensureHealthy });
})();
