// ---------- state ----------
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const transferList = document.getElementById('transferList');
const transfersSection = document.getElementById('transfersSection');
const fileList = document.getElementById('fileList');
const emptyState = document.getElementById('emptyState');
const fileCount = document.getElementById('fileCount');
const addressText = document.getElementById('addressText');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const toast = document.getElementById('toast');

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

function extIcon(name) {
  const ext = name.split('.').pop().slice(0, 4);
  return ext || 'file';
}

// ---------- address + QR ----------

let currentInterfaces = [];
let currentPort = 8080;

function renderQR(url) {
  if (!window.QRCode) return;
  const container = document.getElementById('qrCanvas');
  container.innerHTML = '';
  new window.QRCode(container, {
    text: url,
    width: 152,
    height: 152,
    colorDark: '#0b0f11',
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

function selectAddress(address) {
  const url = `http://${address}:${currentPort}`;
  addressText.textContent = url;
  renderQR(url);
  document.querySelectorAll('.alt-address-item').forEach(el => {
    el.classList.toggle('active', el.dataset.address === address);
  });
}

async function loadInfo() {
  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    currentPort = info.port;
    currentInterfaces = info.interfaces && info.interfaces.length
      ? info.interfaces
      : (info.ips || []).map(ip => ({ address: ip, iface: '' }));

    if (!currentInterfaces.length) {
      addressText.textContent = location.origin;
      return;
    }

    selectAddress(currentInterfaces[0].address);

    const altWrap = document.getElementById('altAddresses');
    if (currentInterfaces.length > 1) {
      altWrap.hidden = false;
      altWrap.querySelector('.alt-list').innerHTML = currentInterfaces.map((i, idx) => `
        <button class="alt-address-item${idx === 0 ? ' active' : ''}" data-address="${i.address}" onclick="window.__selectAddr('${i.address}')">
          <span class="alt-ip">${i.address}</span>
          <span class="alt-iface">${escapeHtmlLite(i.iface || '')}</span>
        </button>
      `).join('');
    } else {
      altWrap.hidden = true;
    }
  } catch {
    addressText.textContent = location.origin;
  }
}
window.__selectAddr = selectAddress;
function escapeHtmlLite(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
loadInfo();

// ---------- websocket live sync ----------

let ws;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    connDot.classList.add('live');
    connText.textContent = 'connected';
  };

  ws.onclose = () => {
    connDot.classList.remove('live');
    connText.textContent = 'reconnecting…';
    setTimeout(connectWS, 1500);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'files') {
      renderFiles(msg.files);
    } else if (msg.type === 'progress') {
      updateRemoteProgress(msg);
    }
  };
}
connectWS();

// ---------- file list rendering ----------

function renderFiles(files) {
  fileCount.textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : '';
  if (!files.length) {
    fileList.innerHTML = '';
    fileList.appendChild(emptyState);
    return;
  }
  fileList.innerHTML = files.map(f => `
    <div class="file-item" data-name="${escapeAttr(f.name)}">
      <div class="file-icon">${escapeHtml(extIcon(f.name))}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-meta">${f.sizeLabel}</div>
      </div>
      <div class="file-actions">
        <a class="icon-btn" href="/download/${encodeURIComponent(f.name)}" download title="Download">⬇</a>
        <button class="icon-btn danger" onclick="deleteFile('${escapeJs(f.name)}')" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function escapeJs(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

window.deleteFile = async (name) => {
  await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
};

// ---------- uploading ----------

function pickFiles() { fileInput.click(); }
dropZone.addEventListener('click', pickFiles);

fileInput.addEventListener('change', () => {
  uploadFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});
dropZone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files);
  if (files.length) uploadFiles(files);
});

function uploadFiles(files) {
  files.forEach(uploadOne);
}

function uploadOne(file) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  transfersSection.hidden = false;

  const item = document.createElement('div');
  item.className = 'transfer-item';
  item.dataset.id = id;
  item.innerHTML = `
    <div class="transfer-top">
      <div class="transfer-name">${escapeHtml(file.name)}</div>
      <div class="transfer-meta"><span class="t-pct">0%</span> · <span class="t-speed">—</span></div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
  `;
  transferList.prepend(item);

  const fill = item.querySelector('.progress-fill');
  const pctLabel = item.querySelector('.t-pct');
  const speedLabel = item.querySelector('.t-speed');

  const xhr = new XMLHttpRequest();
  let lastTime = Date.now();
  let lastLoaded = 0;

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    fill.style.width = pct + '%';
    pctLabel.textContent = pct + '%';

    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    if (dt > 0.2) {
      const speed = (e.loaded - lastLoaded) / dt;
      speedLabel.textContent = formatSpeed(speed);
      lastTime = now;
      lastLoaded = e.loaded;
    }
  });

  xhr.addEventListener('load', () => {
    fill.style.width = '100%';
    pctLabel.textContent = 'done';
    speedLabel.textContent = formatBytes(file.size);
    showToast(`Sent ${file.name}`);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 0.4s';
      setTimeout(() => {
        item.remove();
        if (!transferList.children.length) transfersSection.hidden = true;
      }, 400);
    }, 1200);
  });

  xhr.addEventListener('error', () => {
    pctLabel.textContent = 'failed';
    item.style.borderColor = 'var(--danger)';
    showToast(`Failed to send ${file.name}`);
  });

  const params = new URLSearchParams({ name: file.name, id });
  xhr.open('POST', `/api/upload?${params.toString()}`);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.send(file);
}

function updateRemoteProgress(msg) {
  // Reflect uploads happening from the *other* device too, so both sides see live activity.
  let item = transferList.querySelector(`[data-id="${msg.id}"]`);
  if (!item && !msg.done) {
    transfersSection.hidden = false;
    item = document.createElement('div');
    item.className = 'transfer-item';
    item.dataset.id = msg.id;
    item.innerHTML = `
      <div class="transfer-top">
        <div class="transfer-name">${escapeHtml(msg.name)} <span style="color:var(--text-faint)">(incoming)</span></div>
        <div class="transfer-meta"><span class="t-pct">0%</span></div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
    `;
    transferList.prepend(item);
  }
  if (!item) return;
  const fill = item.querySelector('.progress-fill');
  const pctLabel = item.querySelector('.t-pct');
  fill.style.width = msg.pct + '%';
  pctLabel.textContent = msg.done ? 'done' : msg.pct + '%';
  if (msg.done) {
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 0.4s';
      setTimeout(() => {
        item.remove();
        if (!transferList.children.length) transfersSection.hidden = true;
      }, 400);
    }, 1000);
  }
}
