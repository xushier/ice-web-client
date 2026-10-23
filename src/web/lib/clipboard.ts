/**
 * 复制文本到剪贴板。
 *
 * 浏览器的 navigator.clipboard 只在「安全上下文」可用：
 * https、localhost、127.0.0.1。用局域网 IP + http 打开时它是 undefined，
 * 直接调用会同步抛错、表现成「点了没反应」，所以这里必须带降级方案。
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* 权限被拒时继续走降级 */
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);

  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }

  if (!ok) throw new Error('浏览器拒绝写入剪贴板，请手动选中复制');
}
