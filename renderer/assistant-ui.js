(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const dialog = byId('assistantDialog'), provider = byId('aiProvider'), port = byId('aiPort');
  const model = byId('aiModel'), secret = byId('aiSecret'), question = byId('aiQuestion');
  const send = byId('aiSend'), cancel = byId('aiCancel'), copy = byId('aiCopy');
  const status = byId('aiStatus'), answer = byId('aiAnswer'), attach = byId('aiAttach');
  const key = 'aether.assistant.';
  let selection = '', busy = false;

  function loadProvider() {
    const isOpenCode = provider.value === 'opencode';
    port.value = localStorage.getItem(key + provider.value + '.port') || (isOpenCode ? '4096' : '11434');
    model.value = localStorage.getItem(key + provider.value + '.model') || '';
    model.placeholder = isOpenCode ? 'Server default or provider/model' : 'Installed model name';
    byId('aiSecretLabel').firstElementChild.textContent = isOpenCode ? 'Server password (optional)' : 'API key (optional)';
    secret.value = '';
    byId('aiSetup').textContent = isOpenCode
      ? 'Start OpenCode in an empty folder: opencode serve --hostname 127.0.0.1 --port ' + port.value
      : 'Use a local chat-completions endpoint, such as Ollama. Enter its model name.';
  }
  provider.value = localStorage.getItem(key + 'provider') === 'compatible' ? 'compatible' : 'opencode';
  loadProvider();
  provider.addEventListener('change', loadProvider);
  port.addEventListener('input', () => {
    if (provider.value === 'opencode') byId('aiSetup').textContent = 'Start OpenCode in an empty folder: opencode serve --hostname 127.0.0.1 --port ' + port.value;
  });
  byId('askAI').addEventListener('click', () => {
    const code = byId('code');
    selection = code.value.slice(code.selectionStart, code.selectionEnd);
    attach.disabled = !selection || selection.length > 24000;
    attach.checked = !attach.disabled;
    byId('aiContext').lastElementChild.textContent = selection.length > 24000
      ? 'Select up to 24,000 characters to attach code' : selection ? 'Attach selection (' + selection.length + ' characters)' : 'No code selected';
    byId('aiConnection').open = !localStorage.getItem(key + 'provider');
    dialog.showModal();
    question.focus();
  });
  function setBusy(value) {
    busy = value;
    for (const field of [provider, port, model, secret, send, question]) field.disabled = value;
    cancel.hidden = !value;
  }
  async function ask() {
    if (busy) return;
    const prompt = question.value.trim();
    if (!prompt) { question.focus(); return; }
    if (!port.value || !port.reportValidity() || (provider.value === 'compatible' && !model.value.trim())) {
      byId('aiConnection').open = true; status.textContent = 'Enter a valid port and model for your server.'; return;
    }
    localStorage.setItem(key + 'provider', provider.value);
    localStorage.setItem(key + provider.value + '.port', port.value);
    localStorage.setItem(key + provider.value + '.model', model.value.trim());
    setBusy(true);
    copy.hidden = answer.hidden = true;
    answer.textContent = '';
    status.textContent = 'Waiting for the assistant…';
    try {
      const result = await window.api.askAssistant({ provider: provider.value, port: Number(port.value), model: model.value.trim(),
        password: secret.value, question: prompt, selection: attach.checked ? selection : '' });
      answer.textContent = result;
      answer.hidden = copy.hidden = false;
      status.textContent = 'Answer';
    } catch (error) {
      status.textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally { setBusy(false); }
  }
  cancel.addEventListener('click', () => { if (busy) window.api.cancelAssistant(); });
  byId('closeAI').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (busy) window.api.cancelAssistant(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); ask(); }
  });
  send.addEventListener('click', ask);
  copy.addEventListener('click', async () => {
    try { await window.api.copyText(answer.textContent); status.textContent = 'Answer copied'; }
    catch { status.textContent = 'Could not copy the answer.'; }
  });
})();
