// nyx-wasi-shim.js — polyfill WASI preview1 mínimo para correr módulos Nyx
// (compilados con `make wasm`, target wasm32-wasi) en el NAVEGADOR o en Node,
// sin wasmtime. Cubre los imports que el runtime esencial de Nyx realmente usa
// (fd_write/fd_read/proc_exit/args/fd_* stubs) + random/clock/environ por
// robustez. Sin filesystem: fd_read de stdin devuelve EOF y no hay preopens.
//
// EN: minimal WASI preview1 polyfill to run Nyx wasm32-wasi modules in the
// browser or Node without wasmtime. Covers the imports the essential Nyx
// runtime actually uses; no filesystem (stdin is EOF, no preopens).
//
// Uso / usage:
//   import { runNyxWasm } from "./nyx-wasi-shim.js"
//   const { exitCode, stdout, stderr } = await runNyxWasm(bytes, { args: ["prog"] })

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

class NyxExit {
    constructor(code) { this.code = code; }
}

export function makeWasiImports(state) {
    const td = new TextDecoder();
    const te = new TextEncoder();

    const mem = () => new DataView(state.memory.buffer);
    const bytes = () => new Uint8Array(state.memory.buffer);

    const writeToSink = (fd, chunk) => {
        const text = td.decode(chunk, { stream: true });
        if (fd === 2) { state.stderr += text; } else { state.stdout += text; }
        if (state.onOutput) state.onOutput(fd, text);
    };

    return {
        wasi_snapshot_preview1: {
            args_sizes_get(argcPtr, argvBufSizePtr) {
                const enc = state.args.map(a => te.encode(a + "\0"));
                mem().setUint32(argcPtr, enc.length, true);
                mem().setUint32(argvBufSizePtr, enc.reduce((n, a) => n + a.length, 0), true);
                return ERRNO_SUCCESS;
            },
            args_get(argvPtr, argvBufPtr) {
                let bufOff = argvBufPtr;
                let ptrOff = argvPtr;
                for (const a of state.args) {
                    const enc = te.encode(a + "\0");
                    mem().setUint32(ptrOff, bufOff, true);
                    bytes().set(enc, bufOff);
                    bufOff += enc.length;
                    ptrOff += 4;
                }
                return ERRNO_SUCCESS;
            },
            environ_sizes_get(countPtr, bufSizePtr) {
                mem().setUint32(countPtr, 0, true);
                mem().setUint32(bufSizePtr, 0, true);
                return ERRNO_SUCCESS;
            },
            environ_get() { return ERRNO_SUCCESS; },
            fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
                let written = 0;
                for (let i = 0; i < iovsLen; i++) {
                    const base = mem().getUint32(iovsPtr + i * 8, true);
                    const len = mem().getUint32(iovsPtr + i * 8 + 4, true);
                    writeToSink(fd, bytes().subarray(base, base + len));
                    written += len;
                }
                mem().setUint32(nwrittenPtr, written, true);
                return ERRNO_SUCCESS;
            },
            fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
                // stdin = EOF (sin input interactivo en esta fase)
                mem().setUint32(nreadPtr, 0, true);
                return ERRNO_SUCCESS;
            },
            fd_close() { return ERRNO_SUCCESS; },
            fd_seek(fd, offLo, offHi, whence, newOffPtr) {
                mem().setBigUint64(newOffPtr, 0n, true);
                return ERRNO_SUCCESS;
            },
            fd_fdstat_get(fd, statPtr) {
                // fs_filetype=2 (character_device), flags/rights en cero
                bytes().fill(0, statPtr, statPtr + 24);
                bytes()[statPtr] = 2;
                return ERRNO_SUCCESS;
            },
            // Sin preopens: BADF corta el descubrimiento de directorios de wasi-libc
            fd_prestat_get() { return ERRNO_BADF; },
            fd_prestat_dir_name() { return ERRNO_BADF; },
            random_get(bufPtr, bufLen) {
                const view = bytes().subarray(bufPtr, bufPtr + bufLen);
                if (globalThis.crypto && globalThis.crypto.getRandomValues) {
                    // getRandomValues acepta máx 64KB por llamada
                    for (let off = 0; off < view.length; off += 65536) {
                        globalThis.crypto.getRandomValues(view.subarray(off, Math.min(off + 65536, view.length)));
                    }
                } else {
                    for (let i = 0; i < view.length; i++) view[i] = (Math.random() * 256) | 0;
                }
                return ERRNO_SUCCESS;
            },
            clock_time_get(id, precision, timePtr) {
                mem().setBigUint64(timePtr, BigInt(Date.now()) * 1000000n, true);
                return ERRNO_SUCCESS;
            },
            proc_exit(code) { throw new NyxExit(code); },
        },
    };
}

// Helpers de marshalling para el FFI extern "js" (fase 1 Escenario B).
// Layout de String Nyx en memoria lineal (ABI int64 del runtime):
//   { i64 length @0, i64 capacity @8, u32 data_ptr @16 }  (wasm32: ptr=4 bytes)
// int Nyx = i64 → llega/sale de JS como BigInt.
// EN: marshalling helpers for the extern "js" FFI. Nyx String layout in linear
// memory is {i64 len, i64 cap, u32 ptr}; Nyx int is i64 (JS BigInt).
export function makeNyxHelpers(state) {
    const td = new TextDecoder();
    const te = new TextEncoder();
    const mem = () => new DataView(state.memory.buffer);
    const bytes = () => new Uint8Array(state.memory.buffer);
    return {
        // Lee un String Nyx (puntero i32 a nyx_string) → string JS
        readString(ptr) {
            const len = Number(mem().getBigUint64(ptr, true));
            const dataPtr = mem().getUint32(ptr + 16, true);
            return td.decode(bytes().subarray(dataPtr, dataPtr + len));
        },
        // Construye un String Nyx en memoria wasm (vía nyx_wasi_malloc exportado)
        // → puntero i32 usable como retorno `-> String` de un extern "js"
        makeString(jsStr) {
            if (!state.malloc) throw new Error("makeString: el módulo no exporta nyx_wasi_malloc");
            const data = te.encode(String(jsStr));
            const dataPtr = state.malloc(data.length + 1); // +1 NUL (calloc → ya en cero)
            bytes().set(data, dataPtr);
            const strPtr = state.malloc(24); // {i64,i64,ptr} = 20 en wasm32; 24 con margen
            mem().setBigUint64(strPtr, BigInt(data.length), true);
            mem().setBigUint64(strPtr + 8, BigInt(data.length), true);
            mem().setUint32(strPtr + 16, dataPtr, true);
            return strPtr;
        },
        // Escribe al stdout capturado del shim (state.stdout + onOutput) —
        // console.log iría al proceso host, FUERA del capture de runNyxWasm.
        writeStdout(text) {
            state.stdout += text;
            if (state.onOutput) state.onOutput(1, text);
        },
        // Escapes crudos por si un import necesita más
        memoryBytes: bytes,
        memoryView: mem,
    };
}

// Implementación estándar de los imports js_dom_* de std/dom.nx sobre un DOM
// real (browser) o un mock (tests node: pasá un objeto con querySelector).
// Los eventos llaman fns Nyx EXPORTADAS por nombre → hace falta cerrar el
// círculo post-instanciación: usá el `ref` devuelto.
//   const dom = domBindings();
//   const r = await runNyxWasm(bytes, { js: dom.imports });
//   dom.ref.exports = r.exports;   // habilita los listeners
// EN: standard js_dom_* implementation for std/dom.nx over a real DOM or a
// mock; set ref.exports after runNyxWasm so event listeners can re-enter Nyx.
export function domBindings(doc) {
    const d = doc || globalThis.document;
    const ref = { exports: null };
    const imports = (nyx) => ({
        js_dom_set_text(selPtr, textPtr) {
            const el = d.querySelector(nyx.readString(selPtr));
            if (el) el.textContent = nyx.readString(textPtr);
        },
        js_dom_set_html(selPtr, htmlPtr) {
            const el = d.querySelector(nyx.readString(selPtr));
            if (el) el.innerHTML = nyx.readString(htmlPtr);
        },
        js_dom_get_value(selPtr) {
            const el = d.querySelector(nyx.readString(selPtr));
            return nyx.makeString(el && el.value !== undefined ? el.value : "");
        },
        js_dom_on(selPtr, eventPtr, handlerPtr) {
            // Leer EAGER (los punteros son válidos ahora; el listener corre después)
            const sel = nyx.readString(selPtr);
            const event = nyx.readString(eventPtr);
            const handler = nyx.readString(handlerPtr);
            const el = d.querySelector(sel);
            if (!el) return;
            el.addEventListener(event, () => {
                if (!ref.exports || !ref.exports[handler]) {
                    throw new Error(`dom_on: export Nyx '${handler}' no encontrado (¿#[export_name = "${handler}"]? ¿ref.exports seteado?)`);
                }
                ref.exports[handler]();
            });
        },
        js_console_log(msgPtr) {
            console.log(nyx.readString(msgPtr));
        },
    });
    return { imports, ref };
}

// Corre un módulo Nyx wasm32-wasi. bytes: ArrayBuffer|Uint8Array del .wasm.
// opts.args: argv (default ["nyx"]); opts.onOutput(fd, text): callback streaming.
// opts.js: imports del FFI extern "js" — un objeto { nombre: fn } o una función
//          (nyx) => ({ nombre: fn }) que recibe los helpers de marshalling
//          (nyx.readString / nyx.makeString). Los imports js que el módulo
//          declara y no fueron provistos tiran Error con el nombre exacto.
export async function runNyxWasm(wasmBytes, opts = {}) {
    const state = {
        memory: null,
        malloc: null,
        args: opts.args || ["nyx"],
        stdout: "",
        stderr: "",
        onOutput: opts.onOutput || null,
    };

    const module = await WebAssembly.compile(wasmBytes);
    const helpers = makeNyxHelpers(state);
    const userJs = typeof opts.js === "function" ? opts.js(helpers) : (opts.js || {});

    // Imports del namespace "js" que el módulo realmente declara: los no
    // provistos se stubbean con un error claro (mejor que el críptico
    // "LinkError: import object field ... is not a Function").
    const jsImports = {};
    for (const imp of WebAssembly.Module.imports(module)) {
        if (imp.module !== "js") continue;
        jsImports[imp.name] = userJs[imp.name] ||
            (() => { throw new Error(`import js::${imp.name} no provisto (pasalo en opts.js)`); });
    }

    const instance = await WebAssembly.instantiate(module, {
        ...makeWasiImports(state),
        js: jsImports,
    });
    state.memory = instance.exports.memory;
    if (instance.exports.nyx_wasi_malloc) {
        state.malloc = (n) => instance.exports.nyx_wasi_malloc(BigInt(n));
    }
    let exitCode = 0;
    try {
        instance.exports._start();
    } catch (e) {
        if (e instanceof NyxExit) { exitCode = e.code; } else { throw e; }
    }
    // exports + nyx: para RE-ENTRADA post-_start (fase 2 — callbacks/eventos).
    // Las fns Nyx marcadas #[export_name = "x"] quedan en exports.x; la memoria
    // y el estado del módulo persisten tras _start, así que JS puede llamarlas
    // (listeners de eventos, ticks). Marshalling: mismos helpers (readString/
    // makeString); int = BigInt.
    // EN: exports + marshalling helpers for post-_start re-entry (phase-2
    // callbacks) — module state persists after _start.
    return { exitCode, stdout: state.stdout, stderr: state.stderr,
             exports: instance.exports, nyx: helpers };
}
