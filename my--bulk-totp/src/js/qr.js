/* Local QR encode/decode adapter. Requires vendor/qrcode-generator.js and vendor/jsQR.js. */
(function (root) {
    "use strict";
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const MAX_PIXELS = 16 * 1024 * 1024;

    function render(text, canvas, size) {
        const qr = root.qrcode(0, "M");
        qr.addData(text, "Byte");
        qr.make();
        const count = qr.getModuleCount();
        const quiet = 4;
        const pixels = size || 320;
        const cell = Math.max(1, Math.floor(pixels / (count + quiet * 2)));
        const actual = cell * (count + quiet * 2);
        canvas.width = actual;
        canvas.height = actual;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, actual, actual);
        context.fillStyle = "#0b1220";
        for (let row = 0; row < count; row += 1) for (let column = 0; column < count; column += 1) {
            if (qr.isDark(row, column)) context.fillRect((column + quiet) * cell, (row + quiet) * cell, cell, cell);
        }
        canvas.dataset.qrText = text;
        return canvas;
    }

    function decodeImageData(imageData) {
        const result = root.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
        if (!result || !result.data) throw new Error("图片中未识别到二维码");
        if (result.data.length > 1024 * 1024) throw new Error("二维码内容过大");
        return result.data;
    }

    async function decodeFile(file) {
        if (!file || !file.type.startsWith("image/")) throw new Error("请选择图片文件");
        if (file.size > MAX_FILE_BYTES) throw new Error("图片不能超过 10 MB");
        const bitmap = await createImageBitmap(file);
        try {
            if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error("图片像素过大");
            const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            return decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
        } finally { bitmap.close(); }
    }

    async function scanVideo(video) {
        if (!video.videoWidth || !video.videoHeight) return null;
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1000 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = root.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
        return result && result.data ? result.data : null;
    }

    root.LocalQR = { render, decodeFile, decodeImageData, scanVideo };
})(globalThis);
