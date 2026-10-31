window.requestCheckyVerificationCode = function (email) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'max-width:360px;padding:24px;border-radius:12px;background:#20232a;color:white;border:1px solid #777';
    const form = document.createElement('form');
    const title = document.createElement('h3');
    title.textContent = 'Verify your sign-in';
    const copy = document.createElement('p');
    copy.textContent = 'Enter the code sent to ' + email;
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code';
    input.required = true; input.maxLength = 12; input.setAttribute('aria-label', 'Verification code');
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Verify';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    let finished = false;
    function finish(value) { if (finished) return; finished = true; dialog.close(); dialog.remove(); resolve(value); }
    cancel.onclick = () => finish(null);
    dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
    form.onsubmit = (event) => { event.preventDefault(); finish(input.value.trim()); };
    form.append(title, copy, input, submit, cancel); dialog.append(form); document.body.append(dialog);
    dialog.showModal(); input.focus();
  });
};
