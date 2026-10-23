// Armazenamento das ideias NO PRÓPRIO CELULAR (IndexedDB do navegador). Funciona sem internet.
// Cada ideia tem uma identificação única criada aqui; é ela que evita duplicação na sincronização (etapa 3).
// Nada é apagado automaticamente: só o usuário apaga, e só ideias que ainda não saíram do aparelho.
//
// Formato de uma ideia:
//   { id, texto, capturado, editado?, situacao: 'pendente' | 'enviada' | 'no-cerebro', enviadaEm?, versao: 1 }
//   - pendente:   só existe neste celular
//   - enviada:    chegou ao repositório privado (etapa 3)
//   - no-cerebro: o computador já gravou no Obsidian (etapa 3)
window.Armazenamento = (() => {
  const BANCO = 'cerebro-iii';
  const LOJA = 'ideias';
  const MAX_TEXTO = 20000; // mesmo limite da Caixa de ideias do computador

  let conexao = null;
  function abrir() {
    if (conexao) return Promise.resolve(conexao);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LOJA)) {
          const loja = db.createObjectStore(LOJA, { keyPath: 'id' });
          loja.createIndex('capturado', 'capturado');
          loja.createIndex('situacao', 'situacao');
        }
      };
      req.onsuccess = () => {
        conexao = req.result;
        conexao.onversionchange = () => { conexao.close(); conexao = null; };
        resolve(conexao);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('O armazenamento está em uso por outra aba do app. Feche as outras e tente de novo.'));
    });
  }

  // Executa uma operação e só resolve quando a transação foi gravada de fato.
  async function transacao(modo, fn) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOJA, modo);
      let resultado;
      tx.oncomplete = () => resolve(resultado);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Gravação cancelada.'));
      const r = fn(tx.objectStore(LOJA));
      if (r) r.onsuccess = () => { resultado = r.result; };
    });
  }

  const doisDigitos = (n) => String(n).padStart(2, '0');
  // Data e hora local com fuso, ex.: 2026-10-22T16:45:03-03:00 (igual à Caixa de ideias do computador).
  function isoLocal(d = new Date()) {
    const off = -d.getTimezoneOffset();
    const fuso = `${off >= 0 ? '+' : '-'}${doisDigitos(Math.floor(Math.abs(off) / 60))}:${doisDigitos(Math.abs(off) % 60)}`;
    return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:${doisDigitos(d.getSeconds())}${fuso}`;
  }

  function validar(texto) {
    const t = String(texto || '').replace(/\r\n/g, '\n').trim();
    if (!t) throw new Error('Escreva a ideia antes de salvar.');
    if (t.length > MAX_TEXTO) throw new Error(`Ideia muito longa (máximo ${MAX_TEXTO} caracteres).`);
    return t;
  }

  async function salvar(texto) {
    // criadoEm (milissegundos) só ordena a lista: ideias salvas no mesmo segundo ficam na ordem certa.
    const ideia = { id: crypto.randomUUID(), texto: validar(texto), capturado: isoLocal(), criadoEm: Date.now(), situacao: 'pendente', versao: 1 };
    await transacao('readwrite', (loja) => loja.add(ideia)); // add (não put): nunca sobrescreve
    return ideia;
  }

  async function obter(id) {
    return transacao('readonly', (loja) => loja.get(id));
  }

  // Só ideias pendentes podem ser editadas (as enviadas já saíram do aparelho).
  async function editar(id, texto) {
    const t = validar(texto);
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOJA, 'readwrite');
      const loja = tx.objectStore(LOJA);
      let atualizada = null;
      const req = loja.get(id);
      req.onsuccess = () => {
        const ideia = req.result;
        if (!ideia) { tx.abort(); reject(new Error('Ideia não encontrada.')); return; }
        if (ideia.situacao !== 'pendente') { tx.abort(); reject(new Error('Esta ideia já foi enviada e não pode mais ser editada.')); return; }
        atualizada = { ...ideia, texto: t, editado: isoLocal() };
        loja.put(atualizada);
      };
      tx.oncomplete = () => resolve(atualizada);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function apagar(id) {
    const ideia = await obter(id);
    if (!ideia) return false;
    if (ideia.situacao !== 'pendente') throw new Error('Esta ideia já foi enviada; ela não é apagada daqui.');
    await transacao('readwrite', (loja) => loja.delete(id));
    return true;
  }

  // Todas as ideias, mais recentes primeiro.
  async function listar() {
    const todas = await transacao('readonly', (loja) => loja.getAll());
    const ordem = (i) => i.criadoEm || Date.parse(i.capturado) || 0;
    return (todas || []).sort((a, b) => ordem(b) - ordem(a) || b.id.localeCompare(a.id));
  }

  // Muda a situação (usado pela sincronização da etapa 3).
  async function marcar(id, situacao, extra = {}) {
    const ideia = await obter(id);
    if (!ideia) throw new Error('Ideia não encontrada.');
    const nova = { ...ideia, ...extra, situacao };
    await transacao('readwrite', (loja) => loja.put(nova));
    return nova;
  }

  // Pede ao navegador para não apagar estes dados quando faltar espaço.
  async function pedirPersistencia() {
    try {
      if (!navigator.storage?.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch { return null; }
  }

  return { salvar, obter, editar, apagar, listar, marcar, pedirPersistencia, isoLocal, MAX_TEXTO };
})();
