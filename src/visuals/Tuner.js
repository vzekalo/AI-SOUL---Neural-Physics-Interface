export class Tuner {
    constructor(state, config, containerId = "tuning-overlay") {
        this.state = state;
        this.config = config;
        this.visible = false;

        this.initUI(containerId);
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 't') this.toggle();
        });
    }

    initUI(id) {
        let div = document.getElementById(id);
        if (!div) {
            div = document.createElement('div');
            div.id = id;
            div.style.cssText = `
                position: absolute; top: 10px; right: 10px; width: 220px;
                background: rgba(0,0,0,0.8); border: 1px solid #00f3ff;
                padding: 10px; font-family: 'Share Tech Mono'; color: #00f3ff;
                display: none; z-index: 1000; max-height: 90vh; overflow-y: auto;
                font-size: 11px;
            `;
            document.body.appendChild(div);
        }
        this.el = div;

        this.addHeader("⚫ BLACK HOLE TUNING (Press T)");
        this.addSlider("Mass", "mass", 100, 3000, 10, (v) => this.config.mass = v);
        this.addSlider("Max Accel", "maxAccel", 10, 500, 5, (v) => this.config.maxAccel = v);
        this.addSlider("Epsilon (Soft)", "eps", 1.0, 10.0, 0.1, (v) => this.config.eps = v);
        this.addSlider("Drag", "drag", 0.0, 1.0, 0.01, (v) => this.config.drag = v);
        this.addSlider("Spin", "spin", 0.0, 50.0, 0.5, (v) => this.config.spin = v);

        this.addSeparator();

        this.addSlider("Absorb Rate", "absorbRate", 0.1, 5.0, 0.1, (v) => this.config.absorbRate = v);
        this.addSlider("Shrink Rate", "shrinkRate", 0.0, 1.0, 0.01, (v) => this.config.shrinkRate = v);
        this.addSlider("Tunnel Depth", "tunnelDepth", 0, 100, 1, (v) => this.config.tunnelDepth = v);

        this.addSeparator();

        this.addSlider("Tidal Str", "tidalStrength", 0, 5.0, 0.1, (v) => this.config.tidalStrength = v);
        this.addValue("Current Pull", () => this.state.blackHolePull.toFixed(2));
    }

    addHeader(text) {
        const h = document.createElement('div');
        h.textContent = text;
        h.style.cssText = "font-weight:bold; margin-bottom:8px; text-transform:uppercase;";
        this.el.appendChild(h);
    }

    addSeparator() {
        const s = document.createElement('div');
        s.style.cssText = "height:1px; background:#00f3ff; margin:8px 0; opacity:0.3;";
        this.el.appendChild(s);
    }

    addSlider(label, prop, min, max, step, callback) {
        const row = document.createElement('div');
        row.style.marginBottom = "6px";

        const info = document.createElement('div');
        info.style.display = "flex";
        info.style.justifyContent = "space-between";
        info.innerHTML = `<span>${label}</span> <span id="val-${prop}"></span>`;
        row.appendChild(info);

        const input = document.createElement('input');
        input.type = "range";
        input.min = min;
        input.max = max;
        input.step = step;
        input.style.width = "100%";
        input.style.cursor = "pointer";

        // Initial value
        const current = this.config[prop] !== undefined ? this.config[prop] : min;
        input.value = current;
        row.querySelector(`#val-${prop}`).textContent = current;

        input.oninput = (e) => {
            const v = parseFloat(e.target.value);
            row.querySelector(`#val-${prop}`).textContent = v;
            callback(v);
        };

        row.appendChild(input);
        this.el.appendChild(row);
    }

    addValue(label, provider) {
        const row = document.createElement('div');
        row.style.marginBottom = "4px";
        row.innerHTML = `${label}: <span id="dyn-val-${label.replace(' ', '')}"></span>`;
        this.el.appendChild(row);

        // Simple update loop
        setInterval(() => {
            if (this.visible) {
                const el = document.getElementById(`dyn-val-${label.replace(' ', '')}`);
                if (el) el.textContent = provider();
            }
        }, 200);
    }

    toggle() {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? "block" : "none";
    }
}
