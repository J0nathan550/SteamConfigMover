// Minimal parser for Valve's KeyValues (.vdf) text format.
// Handles quoted strings, nested braces, and // line comments.
// Good enough for loginusers.vdf / localconfig.vdf style files.
// Exposed globally as `parseVdf(text)`.
(function (global) {
  function tokenize(text) {
    const tokens = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
      const ch = text[i];

      // whitespace
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        i++;
        continue;
      }

      // line comment
      if (ch === "/" && text[i + 1] === "/") {
        while (i < len && text[i] !== "\n") i++;
        continue;
      }

      // braces
      if (ch === "{" || ch === "}") {
        tokens.push(ch);
        i++;
        continue;
      }

      // quoted string
      if (ch === '"') {
        let j = i + 1;
        let out = "";
        while (j < len && text[j] !== '"') {
          if (text[j] === "\\" && j + 1 < len) {
            out += text[j + 1];
            j += 2;
          } else {
            out += text[j];
            j++;
          }
        }
        tokens.push({ str: out });
        i = j + 1;
        continue;
      }

      // bare (unquoted) token - rare in Steam files but handle defensively
      {
        let j = i;
        let out = "";
        while (j < len && !/[\s{}]/.test(text[j])) {
          out += text[j];
          j++;
        }
        if (out.length === 0) { i++; continue; }
        tokens.push({ str: out });
        i = j;
      }
    }

    return tokens;
  }

  function parseTokens(tokens) {
    let pos = 0;

    function parseObject() {
      const obj = {};
      while (pos < tokens.length) {
        const tok = tokens[pos];

        if (tok === "}") {
          pos++;
          return obj;
        }

        if (typeof tok !== "object") {
          // stray brace mismatch, bail
          pos++;
          continue;
        }

        const key = tok.str;
        pos++;

        if (tokens[pos] === "{") {
          pos++; // consume {
          const value = parseObject();
          assign(obj, key, value);
        } else if (tokens[pos] && typeof tokens[pos] === "object") {
          const value = tokens[pos].str;
          pos++;
          assign(obj, key, value);
        } else {
          assign(obj, key, null);
        }
      }
      return obj;
    }

    function assign(obj, key, value) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (Array.isArray(obj[key])) {
          obj[key].push(value);
        } else {
          obj[key] = [obj[key], value];
        }
      } else {
        obj[key] = value;
      }
    }

    return parseObject();
  }

  function parseVdf(text) {
    const tokens = tokenize(text);
    return parseTokens(tokens);
  }

  global.parseVdf = parseVdf;
})(window);
