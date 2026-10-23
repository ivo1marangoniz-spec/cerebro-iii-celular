// Criptografia das ideias ANTES de sair do celular (o GitHub só vê texto embaralhado).
// AES-256-GCM com chave derivada da senha do usuário (PBKDF2-SHA256, 310 mil rodadas, sal aleatório por ideia).
// A identificação da ideia entra como "dado associado": um arquivo trocado ou adulterado não abre.
// O computador abre com src/cripto-ideias.js (mesmo formato).
window.Cripto = (() => {
  const FORMATO = 'cerebro-iii-ideia';
  const ITERACOES = 310000;
  const enc = new TextEncoder();

  const paraB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

  async function chave(senha, sal) {
    const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  }

  // Devolve o "envelope" (JSON) que vai para o repositório. Só a identificação fica legível.
  async function criptografar(ideia, senha) {
    if (!senha) throw new Error('Defina a senha da criptografia.');
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const conteudo = { id: ideia.id, texto: ideia.texto, capturado: ideia.capturado, ...(ideia.editado ? { editado: ideia.editado } : {}) };
    const cifrado = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(ideia.id) },
      await chave(senha, sal), enc.encode(JSON.stringify(conteudo)));
    return {
      formato: FORMATO, v: 1, id: ideia.id,
      kdf: { nome: 'PBKDF2-SHA256', iteracoes: ITERACOES, sal: paraB64(sal) },
      cifra: 'AES-256-GCM', iv: paraB64(iv), dados: paraB64(new Uint8Array(cifrado)),
    };
  }

  return { criptografar };
})();
