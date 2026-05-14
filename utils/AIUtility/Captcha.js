'use strict';

/**
 * Captcha.js — Node.js port of Java's AesGcmEncryptionUtils + returnCaptch().
 *
 * Java constants:
 *   ENCRYPT_ALGO   = "AES/GCM/NoPadding"
 *   TAG_LENGTH_BIT = 128   (16 bytes)
 *   AES_KEY_BIT    = 256   (32 bytes)
 *   key            = "Xa/Bc14y7+Y0wq2SFHAuovvsfvnW7PUkKncUstn9z7o="
 *
 * Java decryptNew() flow:
 *   1. Base64-decode encodedStr  →  "<ciphertextB64>::<ivString>"
 *   2. split("::")               →  [ciphertextB64, ivString]
 *   3. key  = Base64.decode(key)
 *   4. iv   = split[1].getBytes()          (raw UTF-8 bytes of the IV string)
 *   5. data = Base64.decode(split[0])      (ciphertext + 16-byte GCM auth tag appended)
 *   6. Cipher.getInstance("AES/GCM/NoPadding")
 *      cipher.init(DECRYPT_MODE, sKey, new GCMParameterSpec(128, iv))
 *      cipher.doFinal(data)
 */

const { createDecipheriv } = require('crypto');
const config = require('./config/UtilityConfig');

// ── Constants from config ─────────────────────────────────────────────────────
const KEY_BUF          = Buffer.from(config.captcha.aesKeyBase64, 'base64');
const TAG_LENGTH_BYTES = config.captcha.tagLengthBytes;

const Captcha = {

    /**
     * Intercepts the captcha API network response and returns the decrypted
     * plain-text captcha string.
     *
     * Mirrors Java:
     *   CommonMethods.returnCaptch(entries, BASE_URL + "users/v3/signup/captcha/gen", "encData")
     *
     * IMPORTANT: Call this BEFORE the page action that triggers the captcha API
     * (e.g. before page.goto) so the listener is active when the response arrives.
     *
     * @param {import('playwright').Page} page       - Playwright page object
     * @param {string}                    captchaUrl - Partial URL of the captcha endpoint
     * @param {string}                    jsonKey    - JSON key holding the encrypted value ("encData")
     * @param {number}                    timeoutMs  - Max wait in ms (default 15000)
     * @returns {Promise<string>}                    - Decrypted plain-text captcha
     */
    returnCaptcha(page, captchaUrl, jsonKey = 'encData', timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            let settled = false;

            const finish = (fn, val) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                page.off('response', handler);
                fn(val);
            };

            const timer = setTimeout(() => {
                finish(reject, new Error(
                    `[Captcha] Timed out after ${timeoutMs}ms — ` +
                    `no response found for URL containing "${captchaUrl}"`
                ));
            }, timeoutMs);

            const handler = async (response) => {
                if (settled) return;

                const url         = response.url();
                const contentType = response.headers()['content-type'] || '';

                // Mirror Java: requestUrl.contains(url)
                if (!url.includes(captchaUrl)) return;
                if (!contentType.includes('json') && !contentType.includes('text')) return;

                let responseContent;
                try {
                    responseContent = await response.text();
                } catch (_) { return; }

                // Mirror Java: if ("base64".equalsIgnoreCase(encoding)) decode first
                // Playwright returns decoded text automatically — check if it looks like JSON
                if (!responseContent || !responseContent.includes(`"${jsonKey}"`)) return;

                // Mark settled synchronously before any await to block duplicate responses
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                page.off('response', handler);

                console.log(`[Captcha] Got encrypted data from: ${url}`);

                try {
                    // Mirror Java: captch = CommonMethods.returnJsonfromObject(responseContent, key)
                    const encData = Captcha._extractJsonKey(responseContent, jsonKey);
                    if (!encData) throw new Error(`[Captcha] Key "${jsonKey}" not found in response`);

                    // Mirror Java: AesGcmEncryptionUtils.decryptNew(captch)
                    const decryptedJson = Captcha.decryptNew(encData);

                    // Mirror Java: returnJsonfromObject(decodedCaptch, "data")
                    const dataJson = Captcha._extractJsonKey(decryptedJson, 'data');

                    // Mirror Java: returnJsonfromObject(datafromString, "captchaString")
                    const captchaB64 = Captcha._extractJsonKey(dataJson, 'captchaString');

                    // Mirror Java: Base64.getDecoder().decode(base64EncodedString)
                    const captchaText = Buffer.from(captchaB64, 'base64').toString('utf8');

                    console.log(`[Captcha] Decrypted captcha: "${captchaText}"`);
                    resolve(captchaText);
                } catch (err) {
                    reject(err);
                }
            };

            page.on('response', handler);
        });
    },

    /**
     * Mirrors Java AesGcmEncryptionUtils.decryptNew(encodedStr):
     *
     *   String[] split = new String(Base64.decode(encodedStr)).split("::");
     *   SecretKey sKey = new SecretKeySpec(Base64.decode(key), "AES");
     *   return decrypt(Base64.decode(split[0].getBytes()), sKey, split[1].getBytes());
     *
     * @param {string} encodedStr - Raw encData value from the API response
     * @returns {string}          - Decrypted JSON string
     */
    decryptNew(encodedStr) {
        // Step 1: Base64-decode the outer envelope
        const envelope = Buffer.from(encodedStr, 'base64').toString('utf8');

        // Step 2: split("::")
        const sep = envelope.indexOf('::');
        if (sep === -1) throw new Error('[Captcha.decryptNew] No "::" separator in envelope');

        const ciphertextB64 = envelope.substring(0, sep);
        const ivStr         = envelope.substring(sep + 2);

        // Step 3: decode components
        // Java: Base64.decode(split[0].getBytes())  →  ciphertext + 16-byte GCM auth tag
        const ciphertextAndTag = Buffer.from(ciphertextB64, 'base64');
        // Java: split[1].getBytes()  →  raw UTF-8 bytes of the IV string
        const ivBuf            = Buffer.from(ivStr, 'utf8');

        // Step 4: AES/GCM/NoPadding — split auth tag (last TAG_LENGTH_BYTES bytes)
        // Java's GCM appends the auth tag after the ciphertext in doFinal() output
        const authTag    = ciphertextAndTag.subarray(ciphertextAndTag.length - TAG_LENGTH_BYTES);
        const cipherOnly = ciphertextAndTag.subarray(0, ciphertextAndTag.length - TAG_LENGTH_BYTES);

        // Step 5: decrypt — mirrors cipher.init(DECRYPT_MODE, sKey, new GCMParameterSpec(128, iv))
        const decipher = createDecipheriv('aes-256-gcm', KEY_BUF, ivBuf);
        decipher.setAuthTag(authTag);
        const plainText = Buffer.concat([decipher.update(cipherOnly), decipher.final()]);

        return plainText.toString('utf8');
    },

    /**
     * Mirrors Java: CommonMethods.returnJsonfromObject(jsonStr, key)
     * Extracts a value from a JSON string by key.
     *
     * @param {string} jsonStr - Raw JSON string
     * @param {string} key     - Key to extract
     * @returns {string|null}
     */
    _extractJsonKey(jsonStr, key) {
        if (!jsonStr) return null;
        try {
            const obj = typeof jsonStr === 'object' ? jsonStr : JSON.parse(jsonStr);
            const val = obj[key];
            if (val === undefined || val === null) return null;
            return typeof val === 'object' ? JSON.stringify(val) : String(val);
        } catch (_) {
            // Fallback: regex for malformed/nested JSON
            const match = jsonStr.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
            return match ? match[1] : null;
        }
    }
};

module.exports = Captcha;
