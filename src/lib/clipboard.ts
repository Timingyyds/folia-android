// src/lib/clipboard.ts
// 复制文本：先用剪贴板 API，没有或被拒（非安全上下文、内嵌浏览器之类）就退回 execCommand；两条都失败才抛错。

export const copyTextToClipboard = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (error) {
            // 剪贴板写入权限被拒时退回到下面的 execCommand。
            console.warn('Clipboard write was rejected, falling back to execCommand:', error);
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        if (!document.execCommand('copy')) throw new Error('execCommand("copy") was refused');
    } finally {
        document.body.removeChild(textarea);
    }
};
