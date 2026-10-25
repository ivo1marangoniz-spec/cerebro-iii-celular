// Sincronização do celular com a "caixa de correio" (repositório PRIVADO no GitHub).
// - Envia cada ideia pendente CRIPTOGRAFADA como ideias/<id>.json. Criar um arquivo que já existe é recusado
//   pelo GitHub, então reenviar nunca duplica.
// - A ideia só vira "enviada" depois que o GitHub confirma. A cópia local nunca é apagada.
// - Quando o computador grava a ideia no Obsidian, deixa um recibo em importadas/<id>.json; ao ler o recibo,
//   a ideia vira "no cérebro" (o arquivo simplesmente sumir não é prova suficiente).
window.Sinc = (() => {
  const A = window.Armazenamento;
  const C = window.Cripto;
  const PASTA = 'ideias';
  const PASTA_RECIBOS = 'importadas'; // o computador deixa um recibo por ideia gravada no Obsidian
  const SENHA_MIN = 10;
  const REPO_VALIDO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
  const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // Configuração fica só neste aparelho (armazenamento do app instalado).
  const ler = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const gravar = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
  const config = () => ({ repo: ler('sinc-repo'), token: ler('sinc-token'), senha: ler('sinc-senha') });
  const configurado = () => { const c = config(); return !!(c.repo && c.token && c.senha); };
  // Endereço da API: GitHub de verdade. Para testes, só caminhos do próprio app são aceitos (ex.: /github-falso).
  const api = () => { const t = ler('sinc-api-teste'); return t.startsWith('/') && !t.startsWith('//') ? t : 'https://api.github.com'; };

  let rodando = false;
  const ocupado = () => rodando;

  async function chamar(metodo, caminho, corpo) {
    const { token } = config();
    const r = await fetch(`${api()}${caminho}`, {
      method: metodo,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    let dados = null;
    try { dados = await r.json(); } catch {}
    return { status: r.status, dados };
  }

  function erroHttp(r) {
    if (r.status === 401) return new Error('Chave de acesso inválida ou vencida. Crie outra no GitHub e cole em Configurar.');
    if (r.status === 403) return new Error('A chave não tem permissão de escrita neste repositório (Contents: Read and write).');
    if (r.status === 404) return new Error('Repositório não encontrado, ou a chave não tem acesso a ele.');
    return new Error(`O GitHub respondeu com erro ${r.status}.`);
  }

  // Confere a chave e se o repositório é PRIVADO (nunca enviamos para um repositório público).
  async function testar() {
    const { repo } = config();
    const r = await chamar('GET', `/repos/${repo}`);
    if (r.status !== 200) throw erroHttp(r);
    if (r.dados?.private !== true) throw new Error('Este repositório é público. Por segurança, use apenas um repositório PRIVADO.');
    if (r.dados?.permissions && r.dados.permissions.push === false) throw new Error('A chave só tem permissão de leitura. Ela precisa de "Contents: Read and write".');
    return true;
  }

  function salvarConfig({ repo, token, senha }) {
    repo = String(repo || '').trim();
    token = String(token || '').trim();
    if (!REPO_VALIDO.test(repo)) throw new Error('Repositório no formato usuario/nome.');
    if (!token) throw new Error('Cole a chave de acesso do GitHub.');
    if (String(senha || '').length < SENHA_MIN) throw new Error(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
    gravar('sinc-repo', repo);
    gravar('sinc-token', token);
    gravar('sinc-senha', senha);
  }
  // Remover a configuração também apaga a cópia do painel de metas guardada aqui.
  function apagarConfig() { for (const k of ['sinc-repo', 'sinc-token', 'sinc-senha', 'painel-cache', 'painel-baixado']) gravar(k, ''); }

  // Converte em partes: passar milhares de bytes de uma vez estoura o limite do Safari.
  function b64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }

  async function enviarUma(ideia) {
    const { repo, senha } = config();
    const envelope = await C.criptografar(ideia, senha);
    const caminho = `/repos/${repo}/contents/${PASTA}/${ideia.id}.json`;
    const r = await chamar('PUT', caminho, { message: `Ideia ${ideia.id}`, content: b64(JSON.stringify(envelope)) });
    if (r.status === 201 || r.status === 200) return true;
    if (r.status === 422) {
      // Já existe um arquivo com essa identificação: foi enviado antes (ex.: a conexão caiu antes da confirmação).
      const existe = await chamar('GET', caminho);
      if (existe.status === 200) return true;
    }
    throw erroHttp(r);
  }

  // Envia as pendentes e atualiza quem já chegou ao cérebro. Devolve um resumo.
  async function sincronizar() {
    if (rodando) return { ignorado: true };
    if (!configurado()) return { semConfig: true };
    if (!navigator.onLine) return { offline: true };
    rodando = true;
    const resumo = { enviadas: 0, noCerebro: 0, reenviadas: 0, erro: null };
    try {
      await testar();
      const { repo } = config();

      // 1. Recibos deixados pelo computador depois de gravar no Obsidian: só eles confirmam "No cérebro".
      const r = await chamar('GET', `/repos/${repo}/contents/${PASTA_RECIBOS}`);
      if (r.status === 200 && Array.isArray(r.dados)) {
        for (const f of r.dados) {
          const id = String(f.name || '').replace(/\.json$/, '');
          if (f.type !== 'file' || !ID_VALIDO.test(id)) continue;
          const ideia = await A.obter(id);
          if (ideia && ideia.situacao !== 'no-cerebro') { await A.marcar(id, 'no-cerebro', { noCerebroEm: A.isoLocal() }); resumo.noCerebro++; }
          // Recibo lido: pode sair do repositório (se falhar, tenta na próxima vez).
          if (ideia) await chamar('DELETE', `/repos/${repo}/contents/${PASTA_RECIBOS}/${f.name}`, { message: `Recibo lido ${id}`, sha: f.sha });
        }
      }

      // 2. Enviada que sumiu do repositório SEM recibo (ex.: apagada no site do GitHub) volta para a fila.
      //    Reenviar não duplica: o computador reconhece a identificação.
      const enviadas = (await A.listar()).filter((i) => i.situacao === 'enviada');
      if (enviadas.length) {
        const l = await chamar('GET', `/repos/${repo}/contents/${PASTA}`);
        let presentes = null;
        if (l.status === 200 && Array.isArray(l.dados)) presentes = new Set(l.dados.map((f) => String(f.name || '').replace(/\.json$/, '')));
        else if (l.status === 404) presentes = new Set();
        if (presentes) {
          for (const i of enviadas) if (!presentes.has(i.id)) { await A.marcar(i.id, 'pendente', { reenviar: true }); resumo.reenviadas++; }
        }
      }

      // 3. Envia as pendentes (mais antigas primeiro).
      const ideias = await A.listar();
      for (const ideia of ideias.filter((i) => i.situacao === 'pendente').reverse()) {
        // Relê a ideia: se foi editada ou apagada enquanto a fila andava, usa a versão atual.
        const atual = await A.obter(ideia.id);
        if (!atual || atual.situacao !== 'pendente') continue;
        await enviarUma(atual);
        await A.marcar(atual.id, 'enviada', { enviadaEm: A.isoLocal() });
        resumo.enviadas++;
      }
      gravar('sinc-ultima', A.isoLocal());
    } catch (err) {
      resumo.erro = err.message === 'Failed to fetch' || err.name === 'TypeError' ? 'Sem conexão com o GitHub agora. As ideias continuam guardadas e serão enviadas depois.' : err.message;
    } finally {
      rodando = false;
    }
    return resumo;
  }

  // ---------- painel de metas (o PC publica em painel/metas.json, trancado com a mesma senha) ----------
  // A última versão aberta fica guardada neste aparelho: a aba Metas funciona sem internet e com o PC desligado.
  function validarResumo(r) {
    const ok = r && r.v === 1 && typeof r.geradoEm === 'string' && Array.isArray(r.metas) && r.metas.length <= 100
      && r.metas.every((m) => typeof m.titulo === 'string' && ['foco', 'ativa'].includes(m.situacao)
        && Number.isInteger(m.feitas) && Number.isInteger(m.total)
        && (m.proxima === null || (Number.isInteger(m.proxima?.numero) && typeof m.proxima?.titulo === 'string'
          && (m.proxima.comoFazer === undefined || (typeof m.proxima.comoFazer === 'string' && m.proxima.comoFazer.length <= 2000)))));
    const agendaOk = r.agenda === undefined || r.agenda === null || (Array.isArray(r.agenda) && r.agenda.length <= 150
      && r.agenda.every((e) => typeof e.titulo === 'string' && typeof e.inicio === 'string' && typeof e.fim === 'string' && typeof e.diaInteiro === 'boolean'));
    if (!ok || !agendaOk) throw new Error('O painel de metas veio num formato inesperado.');
    return r;
  }
  function painelGuardado() {
    try { return JSON.parse(ler('painel-cache') || 'null'); } catch { return null; }
  }
  async function baixarPainel() {
    if (!configurado()) return { semConfig: true };
    if (!navigator.onLine) return { offline: true };
    const { repo, senha } = config();
    let r;
    try { r = await chamar('GET', `/repos/${repo}/contents/painel/metas.json`); } catch { return { offline: true }; }
    if (r.status === 404) return { semPainel: true };
    if (r.status !== 200 || typeof r.dados?.content !== 'string') throw erroHttp(r);
    const bytes = Uint8Array.from(atob(r.dados.content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
    const resumo = validarResumo(await C.abrirPainel(JSON.parse(new TextDecoder().decode(bytes)), senha));
    gravar('painel-cache', JSON.stringify(resumo));
    gravar('painel-baixado', A.isoLocal());
    return { resumo };
  }

  return { config, configurado, salvarConfig, apagarConfig, testar, sincronizar, ocupado, ultima: () => ler('sinc-ultima'), SENHA_MIN, baixarPainel, painelGuardado };
})();
