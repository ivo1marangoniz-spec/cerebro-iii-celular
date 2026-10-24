// Criptografia das ideias ANTES de sair do celular (o GitHub só vê texto embaralhado).
// AES-256-GCM com chave derivada da senha do usuário (PBKDF2-SHA256, 310 mil rodadas, sal aleatório por ideia).
// A identificação da ideia entra como "dado associado": um arquivo trocado ou adulterado não abre.
// O computador abre com src/cripto-ideias.js (mesmo formato).
window.Cripto = (() => {
  const FORMATO = 'cerebro-iii-ideia';
  const ITERACOES = 310000;
  const enc = new TextEncoder();

  const paraB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

  async function chave(senha, sal, uso = 'encrypt', iteracoes = ITERACOES) {
    const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes },
      base, { name: 'AES-GCM', length: 256 }, false, [uso]);
  }
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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

  // Abre o painel de metas que o PC trancou com a mesma senha (src/painel-celular.js). O arquivo vem do GitHub,
  // então é tratado como não confiável: formato e tamanhos são conferidos antes de abrir.
  async function abrirPainel(env, senha) {
    const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
    const it = env?.kdf?.iteracoes;
    if (env?.formato !== 'cerebro-iii-painel' || env.v !== 1 || env.id !== 'painel-metas' || env.cifra !== 'AES-256-GCM'
      || env.kdf?.nome !== 'PBKDF2-SHA256' || !Number.isInteger(it) || it < 100000 || it > 2000000
      || ![env.iv, env.kdf.sal, env.dados].every((x) => typeof x === 'string' && B64.test(x)) || env.dados.length > 300000) {
      throw new Error('O painel de metas veio num formato desconhecido.');
    }
    let claro;
    try {
      claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(env.iv), additionalData: enc.encode(env.id) },
        await chave(senha, deB64(env.kdf.sal), 'decrypt', it), deB64(env.dados));
    } catch {
      throw new Error('Não consegui abrir o painel: a senha deste celular é diferente da do computador.');
    }
    return JSON.parse(new TextDecoder().decode(claro));
  }

  return { criptografar, abrirPainel };
})();
