//sem comentários    
const supabaseUrl = 'https://cugfezglvaclawbhtola.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1Z2ZlemdsdmFjbGF3Ymh0b2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0NzM0OTEsImV4cCI6MjA1ODA0OTQ5MX0.3gT5tWcu1fboof_qWWtu-05QhCoiVdTccLirTIPbUTk';
const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

let productsdb = [];
let pantonedb = [];
let processStandardsdb = [];
let selectedcolor = null;
let allInspectionsData = [];
let lastInspections = [];
let histogramChartInstance = null;
let diagnosticChartInstance = null;
const DIAGNOSTIC_TOLERANCE = 0.5;

let shiftChartInstance = null; // Instância do gráfico de turnos

let productDescriptions = {}; // Variável global para descrições
let coloristasDb = {}; // Variável global para coloristas { matricula: { nome, turno } }

/**
 * Função para exibir um modal customizado, não cancelável, que força o preenchimento de justificativa.
 * Retorna uma Promise que só resolve quando o usuário fornece uma justificativa válida (>= 5 chars).
 */
function showRequiredJustificationModal(title, msg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('justificationModal');
    const input = document.getElementById('modalInput');
    const btn = document.getElementById('modalSubmitBtn');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');

    // Configura texto do modal
    titleEl.innerHTML = title ? `<i class="fas fa-exclamation-triangle"></i> ${title}` : '<i class="fas fa-exclamation-triangle"></i> REPROVAÇÃO CONSECUTIVA!';
    msgEl.textContent = msg || 'Esta OP já teve uma reprovação anterior. Por favor, descreva detalhadamente a ação corretiva tomada.';
    
    // Resetar estado inicial
    input.value = '';
    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.opacity = '0.5';
    input.style.borderColor = "#dee2e6";
    modal.style.display = 'flex';

    // Focar no campo de texto
    setTimeout(() => input.focus(), 100);

    // Validação em tempo real
    input.oninput = () => {
      const val = input.value.trim();
      if (val.length >= 5) {
        btn.disabled = false;
        btn.style.cursor = 'pointer';
        btn.style.opacity = '1';
        input.style.borderColor = '#28a745';
      } else {
        btn.disabled = true;
        btn.style.cursor = 'not-allowed';
        btn.style.opacity = '0.5';
        input.style.borderColor = '#dee2e6';
      }
    };

    // Resposta ao clique
    btn.onclick = () => {
      modal.style.display = 'none';
      resolve(input.value.trim());
    };
  });
}

async function checkLastInspectionStatus(tableName, product, op) {
  try {
    const statusCol = tableName === "color_inspections" ? "status" : "status_geral";
    let query = sb.from(tableName)
      .select(`${statusCol}, bobina`)
      .eq(tableName === "color_inspections" ? "product" : "produto", product);

    // Tratar filtro de OP
    const opColumn = tableName === "color_inspections" ? "op" : "op_number";
    if (!op || op === "" || op === "-") {
      // Sem OP: buscar apenas por produto (não filtrar por OP)
      // Não usar .is(null) pois pode haver registros com e sem OP
    } else {
      query = query.eq(opColumn, op);
    }

    // IMPORTANTE: neq("bobina", "Acerto de Cor") exclui NULLs no PostgreSQL!
    // Usamos .or() para incluir bobina IS NULL OU bobina diferente de "Acerto de Cor"
    if (tableName === "color_inspections") {
      query = query.or('bobina.is.null,bobina.neq.Acerto de Cor');
    }

    const { data, error } = await query
      .order(tableName === "color_inspections" ? "timestamp" : "created_at", { ascending: false })
      .limit(1);

    console.log("[JUSTIFICATIVA] Consulta:", { tableName, product, op, data, error });

    if (error) throw error;
    if (data && data.length > 0) {
      const statusValue = tableName === "color_inspections" ? data[0].status : data[0].status_geral;
      console.log("[JUSTIFICATIVA] Último status encontrado:", statusValue);
      return (statusValue || "").toString().trim();
    }
    console.log("[JUSTIFICATIVA] Nenhuma inspeção anterior encontrada.");
  } catch (e) {
    console.error("Erro ao verificar última inspeção:", e);
  }
  return null;
}

async function fetchProductDescriptions() {
  let allDescriptions = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;

  try {
    while (keepFetching) {
      // Busca da nova tabela criada: product_descriptions
      // Note que usamos "Description" com D maiúsculo para casar com o CSV importado
      const { data, error } = await sb.from("product_descriptions")
        .select("product, Description")
        .range(offset, offset + batchSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allDescriptions = allDescriptions.concat(data);
        if (data.length < batchSize) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }

    // Transforma o array do banco em um objeto: { "5627": "AUSTER NUMIA", ... }
    productDescriptions = allDescriptions.reduce((acc, item) => {
      if (item.product) {
        // Limpa o código (remove hifens se houver) para garantir o match
        const code = item.product.toString().split('-')[0].trim();
        acc[code] = item.Description || "-";
      }
      return acc;
    }, {});

    console.log("Descrições carregadas do Supabase:", Object.keys(productDescriptions).length);
  } catch (e) {
    console.error("Erro ao buscar descrições no Supabase:", e);
    // Fallback para não quebrar o app
    productDescriptions = {};
  }
}

async function fetchColoristas() {
  try {
    const { data, error } = await sb.from('coloristas').select('*');
    if (error) throw error;
    coloristasDb = {};
    (data || []).forEach(item => {
      coloristasDb[item.matricula] = { nome: item.nome, turno: item.turno };
    });
    console.log('Coloristas carregados:', Object.keys(coloristasDb).length);
  } catch (e) {
    console.error('Erro ao carregar coloristas:', e);
    coloristasDb = {};
  }
}

function lookupColorista(inputId, displayId) {
  const matricula = document.getElementById(inputId).value.trim();
  const displayEl = document.getElementById(displayId);
  if (!displayEl) return;
  const colorista = coloristasDb[matricula];
  if (colorista) {
    displayEl.textContent = `✅ ${colorista.nome} (${colorista.turno})`;
    displayEl.style.color = 'var(--success)';
  } else if (matricula.length > 0) {
    displayEl.textContent = '❌ Matrícula não encontrada';
    displayEl.style.color = 'var(--danger)';
  } else {
    displayEl.textContent = '';
  }
}

function setBobinaId(text) {
  const bobinaInput = document.getElementById('bobinaid');
  bobinaInput.value = text;
}

function ciede2000(l1, a1, b1, l2, a2, b2) {
  const pi = Math.PI, rad2deg = 180 / pi, deg2rad = pi / 180;
  const c1 = Math.sqrt(a1 * a1 + b1 * b1), c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const c1c2 = (c1 + c2) / 2.0, c1c2pow7 = Math.pow(c1c2, 7);
  const g = 0.5 * (1.0 - Math.sqrt(c1c2pow7 / (c1c2pow7 + Math.pow(25, 7))));
  const a1p = (1.0 + g) * a1, a2p = (1.0 + g) * a2;
  const c1p = Math.sqrt(a1p * a1p + b1 * b1), c2p = Math.sqrt(a2p * a2p + b2 * b2);
  let h1p = Math.atan2(b1, a1p); if (h1p < 0) h1p += 2 * pi; h1p *= rad2deg;
  let h2p = Math.atan2(b2, a2p); if (h2p < 0) h2p += 2 * pi; h2p *= rad2deg;
  const dlp = l2 - l1, dcp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dhp2 = 2.0 * Math.sqrt(c1p * c2p) * Math.sin((dhp * deg2rad) / 2.0);
  const lpmean = (l1 + l2) / 2.0, cpmean = (c1p + c2p) / 2.0;
  let hmean = 0;
  if (c1p * c2p !== 0) {
    hmean = (h1p + h2p) / 2.0;
    if (Math.abs(h1p - h2p) > 180) hmean += 180;
    if (hmean > 360) hmean -= 360;
  }
  const t = 1 - 0.17 * Math.cos((hmean - 30) * deg2rad) + 0.24 * Math.cos((2 * hmean) * deg2rad) + 0.32 * Math.cos((3 * hmean + 6) * deg2rad) - 0.20 * Math.cos((4 * hmean - 63) * deg2rad);
  const lpmean_minus_50squared = (lpmean - 50) * (lpmean - 50);
  const sl = 1 + (0.015 * lpmean_minus_50squared) / Math.sqrt(20 + lpmean_minus_50squared);
  const sc = 1 + 0.045 * cpmean;
  const sh = 1 + 0.015 * cpmean * t;
  const dtheta = 30 * Math.exp(-Math.pow((hmean - 275) / 25, 2));
  const cpmeanPow7 = Math.pow(cpmean, 7);
  const rc = 2 * Math.sqrt(cpmeanPow7 / (cpmeanPow7 + Math.pow(25, 7)));
  const rt = -rc * Math.sin(2 * dtheta * deg2rad);
  const kl = 1, kc = 1, kh = 1;
  const dlpsl = dlp / (kl * sl), dcpsc = dcp / (kc * sc), dhpsh = dhp2 / (kh * sh);
  return Math.sqrt(dlpsl * dlpsl + dcpsc * dcpsc + dhpsh * dhpsh + rt * dcpsc * dhpsh);
}
function updateColorSample(element, l, a, b) {
  if (!element) return;
  const lVal = Math.max(0, Math.min(100, parseFloat(l) || 0));
  const aVal = parseFloat(a) || 0;
  const bVal = parseFloat(b) || 0;
  element.style.backgroundColor = (!isNaN(lVal) && !isNaN(aVal) && !isNaN(bVal)) ? `lab(${lVal}% ${aVal} ${bVal})` : '#808080';
}
function saveOpState() {
  const opInput = document.getElementById("opid");
  const fixarOpCheckbox = document.getElementById("fixarop");
  const matriculaInput = document.getElementById("matriculaId");
  const fixarMatriculaCheckbox = document.getElementById("fixarmatricula");

  // Campos do Processo (CMYK)
  const pcMatriculaInput = document.getElementById("pc_matricula");
  const pcFixarMatriculaCheckbox = document.getElementById("pc_fixarmatricula");

  if (opInput && fixarOpCheckbox) {
    localStorage.setItem('savedOp', opInput.value);
    localStorage.setItem('isOpFixed', fixarOpCheckbox.checked);
  }

  if (matriculaInput && fixarMatriculaCheckbox) {
    localStorage.setItem('savedMatricula', matriculaInput.value);
    localStorage.setItem('isMatriculaFixed', fixarMatriculaCheckbox.checked);
  }

  if (pcMatriculaInput && pcFixarMatriculaCheckbox) {
    localStorage.setItem('savedPcMatricula', pcMatriculaInput.value);
    localStorage.setItem('isPcMatriculaFixed', pcFixarMatriculaCheckbox.checked);
  }
}

function loadOpState() {
  // Carregamento de OP
  const savedOp = localStorage.getItem('savedOp');
  const isOpFixed = localStorage.getItem('isOpFixed') === 'true';
  const opInput = document.getElementById("opid");
  const fixarOpCheckbox = document.getElementById("fixarop");
  if (opInput && fixarOpCheckbox) {
    if (savedOp) opInput.value = savedOp;
    fixarOpCheckbox.checked = isOpFixed;
  }

  // Carregamento de Matrícula (Cor)
  const savedMatricula = localStorage.getItem('savedMatricula');
  const isMatriculaFixed = localStorage.getItem('isMatriculaFixed') === 'true';
  const matriculaInput = document.getElementById("matriculaId");
  const fixarMatriculaCheckbox = document.getElementById("fixarmatricula");
  if (matriculaInput && fixarMatriculaCheckbox) {
    if (savedMatricula) matriculaInput.value = savedMatricula;
    fixarMatriculaCheckbox.checked = isMatriculaFixed;
    if (savedMatricula) lookupColorista('matriculaId', 'coloristaNome');
  }

  // Carregamento de Matrícula (Processo)
  const savedPcMatricula = localStorage.getItem('savedPcMatricula');
  const isPcMatriculaFixed = localStorage.getItem('isPcMatriculaFixed') === 'true';
  const pcMatriculaInput = document.getElementById("pc_matricula");
  const pcFixarMatriculaCheckbox = document.getElementById("pc_fixarmatricula");
  if (pcMatriculaInput && pcFixarMatriculaCheckbox) {
    if (savedPcMatricula) pcMatriculaInput.value = savedPcMatricula;
    pcFixarMatriculaCheckbox.checked = isPcMatriculaFixed;
    if (savedPcMatricula) lookupColorista('pc_matricula', 'pc_colorista_nome');
  }
}

function showTab(tabId) {
  // 1. Remove a classe 'active' de todas as abas e conteúdos
  document.querySelectorAll(".nav-tab").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

  // 2. Encontra e ativa a aba e o conteúdo clicados
  const activeNavTab = Array.from(document.querySelectorAll('.nav-tab')).find(el => el.getAttribute('onclick').includes(`'${tabId}'`));
  const activeTabContent = document.getElementById(tabId + "-tab");

  if (activeNavTab) activeNavTab.classList.add("active");
  if (activeTabContent) activeTabContent.classList.add("active");

  // 3. Lógica de carregamento de dados por aba
  switch (tabId) {
    case 'database-color':
      if (allInspectionsData.length === 0 && !isSearchActive) loadInitialInspections();
      break;

    case 'register':
      if (productsdb.length === 0) loadproducts();
      break;

    case 'bestmatch':
      // ALTERAÇÃO AQUI: Verifica e carrega ambas as bases
      if (productsdb.length === 0) loadproducts();
      if (pantonedb.length === 0) loadpantones();
      break;

    case 'database-process':
      fetchAndDisplayProcessInspections();
      break;
    case 'pantone-search':
      if (pantonedb.length === 0) loadpantones();
      break;

    case 'process-register':
      loadProcessStandardsDb();
      resetProcessRegisterTable(); // Garante que volta ao CMYK padrão ao entrar
      break;
    case 'profiles-history':
      populateProfileSelector();
      break;
    case 'description-manager':
      document.getElementById('descriptionManagerMessage').textContent = "";
      break;
  }
}

function goback() {
  document.getElementById("inspector").style.display = "none";
  document.getElementById("results").style.display = "flex";
  document.getElementById("fixedbackbutton").style.display = "none";
  selectedcolor = null;
  document.getElementById('diagnostico-btn').style.display = 'none';
  document.getElementById("original-color-name").textContent = "Cor Original";
}

function searchproducts() {
  const productcode = document.getElementById("productcode").value.toLowerCase().trim();
  const results = document.getElementById("results");
  results.innerHTML = "";
  results.style.display = "flex";
  document.getElementById("inspector").style.display = "none";
  document.getElementById("fixedbackbutton").style.display = "none";
  let matches = !productcode ? productsdb : productsdb.filter(p => p.name.toLowerCase().includes(productcode));
  if (matches.length === 0) { results.innerHTML = "Nenhum produto correspondente encontrado."; return; }
  matches.forEach(match => {
    const productCode = match.name.split('-')[0].trim();
    const description = productDescriptions[productCode] || "-";
    const matchdiv = document.createElement("div");
    matchdiv.classList.add("match");
    matchdiv.innerHTML = `<span>${match.name} <br><small style="color: #666;">${description}</small></span><div class="color-sample" style="background-color: lab(${match.l}% ${match.a} ${match.b});"></div>`;
    matchdiv.onclick = () => {
      selectedcolor = match;
      document.getElementById("original-color-name").textContent = selectedcolor.name;
      document.getElementById("results").style.display = "none";
      document.getElementById("inspector").style.display = "flex";
      document.getElementById("labl").value = "";
      document.getElementById("laba").value = "";
      document.getElementById("labb").value = "";
      document.getElementById("bobinaid").value = "";
      if (!document.getElementById("fixarop").checked) document.getElementById("opid").value = "";
      if (!document.getElementById("fixarmatricula").checked) {
        document.getElementById("matriculaId").value = "";
        document.getElementById("coloristaNome").textContent = "";
      }
      document.getElementById("resultmessage").textContent = "";
      document.getElementById("deltal").textContent = "";
      document.getElementById("deltaa").textContent = "";
      document.getElementById("deltab").textContent = "";
      updateColorSample(document.getElementById("colorsampleref"), selectedcolor.l, selectedcolor.a, selectedcolor.b);
      updateColorSample(document.getElementById("colorsamplesample"), 0, 0, 0);
      document.getElementById("fixedbackbutton").style.display = "block";
      document.getElementById('diagnostico-btn').style.display = 'none';
    };
    results.appendChild(matchdiv);
  });
}

// NOVO: Event listener para carregar descrição em tempo real no Gerenciador de Descrições
document.getElementById('manager_product_code').addEventListener('input', (e) => {
  const code = e.target.value.trim();
  const descInput = document.getElementById('manager_description');
  if (descInput) {
    descInput.value = productDescriptions[code] || "";
  }
});

// NOVO: Função para o botão de Pesquisar no Gerenciador de Descrições (Explícito)
function searchOnlyDescriptionManager() {
  const code = document.getElementById('manager_product_code').value.trim();
  const descInput = document.getElementById('manager_description');
  const msgEl = document.getElementById('descriptionManagerMessage');

  if (!code) {
    alert("Digite o código do produto!");
    return;
  }

  const description = productDescriptions[code];
  if (description) {
    descInput.value = description;
    msgEl.textContent = "Produto encontrado!";
    msgEl.style.color = "var(--success)";
  } else {
    descInput.value = "";
    msgEl.textContent = "Código não encontrado no banco local.";
    msgEl.style.color = "var(--warning)";
  }
}

// Listener simplificado para o Cadastro CMYK (apenas visual)
document.getElementById('reg_proc_product_code').addEventListener('input', (e) => {
  const code = e.target.value.trim();
  const descDisplay = document.getElementById('cmyk_desc_display');
  if (descDisplay) {
    descDisplay.textContent = productDescriptions[code] || "";
  }
});

// NOVO: Função para o botão de Pesquisar no Cadastro CMYK
async function searchProcessStandardsTab() {
  const code = document.getElementById('reg_proc_product_code').value.trim();
  if (!code) {
    alert("Digite um código para pesquisar.");
    return;
  }

  const msgEl = document.getElementById("processRegisterMessage");
  msgEl.textContent = "Pesquisando...";
  msgEl.style.color = "var(--primary)";

  // Verifica se existe no banco de padrões localmente
  const existsLocal = processStandardsdb.some(p => String(p.product_code).trim() === String(code).trim());
  
  if (existsLocal) {
    await editProcessProduct(code);
    msgEl.textContent = "Padrões carregados com sucesso!";
    msgEl.style.color = "var(--success)";
  } else {
    // Fallback: tentar direto no banco com busca flexível
    try {
      // Tenta busca exata primeiro, depois busca parcial se falhar
      let { data, error } = await sb.from("process_standards")
        .select("product_code")
        .ilike("product_code", code) // ilike é case-insensitive e mais flexível em alguns drivers
        .limit(1);
      
      if (error) {
        console.error("Erro na busca fallback:", error);
        msgEl.textContent = `Erro na pesquisa: ${error.message}`;
        msgEl.style.color = "var(--danger)";
        return;
      }

      // Se não achou com ilike exato, tenta conter (caso haja espaços invisíveis no banco)
      if (!data || data.length === 0) {
         const resp = await sb.from("process_standards")
          .select("product_code")
          .ilike("product_code", `%${code}%`)
          .limit(1);
         data = resp.data;
      }

      if (data && data.length > 0) {
        // Se achou no banco mas não no cache, o cache está desatualizado
        const actualCode = data[0].product_code;
        await editProcessProduct(actualCode);
        msgEl.textContent = "Padrões carregados (Sincronizado com Banco)!";
        msgEl.style.color = "var(--success)";
        // Força atualização do cache local
        loadProcessStandardsDb();
        return;
      }
    } catch(e) {
      console.error("Exceção na pesquisa fallback:", e);
      msgEl.textContent = `Erro inesperado: ${e.message}`;
      msgEl.style.color = "var(--danger)";
      return;
    }

    resetProcessRegisterTable(true);
    msgEl.textContent = `Nenhum padrão encontrado para o código [${code}].`;
    msgEl.style.color = "var(--warning)";
  }
}

// NOVO: Função para salvar descrição pela nova aba
async function saveOnlyDescriptionManager() {
  const code = document.getElementById("manager_product_code").value.trim();
  const description = document.getElementById("manager_description").value.trim();
  const msgEl = document.getElementById("descriptionManagerMessage");

  if (!code) {
    alert("Digite o código do produto!");
    return;
  }

  try {
    const { error } = await sb.from("product_descriptions").upsert({
      product: code,
      Description: description
    });

    if (error) throw error;

    productDescriptions[code] = description || "-";
    msgEl.textContent = "Sucesso! Descrição atualizada no Supabase.";
    msgEl.style.color = "var(--success)";

    updateproductstable();
    loadInspections(0, false);
  } catch (e) {
    console.error("Erro ao salvar descrição:", e);
    msgEl.textContent = "Erro ao salvar: " + e.message;
    msgEl.style.color = "var(--danger)";
  }
}

function updatesamplecolor() {
  const l2 = parseFloat(document.getElementById("labl").value) || 0;
  const a2 = parseFloat(document.getElementById("laba").value) || 0;
  const b2 = parseFloat(document.getElementById("labb").value) || 0;
  updateColorSample(document.getElementById("colorsamplesample"), l2, a2, b2);
}
async function inspectcolor() {
  if (!selectedcolor) { alert("Nenhum produto selecionado!"); return; }
  const l2 = parseFloat(document.getElementById("labl").value);
  const a2 = parseFloat(document.getElementById("laba").value);
  const b2 = parseFloat(document.getElementById("labb").value);
  const bobina = document.getElementById("bobinaid").value.trim();
  const op = document.getElementById("opid").value.trim() || null;
  const matricula = document.getElementById("matriculaId").value.trim() || null;
  const coloristaInfo = matricula ? coloristasDb[matricula] : null;
  const coloristaNome = coloristaInfo ? coloristaInfo.nome : null;
  if (isNaN(l2) || isNaN(a2) || isNaN(b2) || l2 < 0 || l2 > 100) { alert("Valores L, a, b inválidos."); return; }
  const deltae = ciede2000(selectedcolor.l, selectedcolor.a, selectedcolor.b, l2, a2, b2);
  const status = deltae <= 2 ? "Aprovado" : "Reprovado";
  const resultmessage = document.getElementById("resultmessage");
  resultmessage.textContent = `Delta E: ${deltae.toFixed(2)} - ${status}`;
  resultmessage.style.color = status === "Aprovado" ? "var(--success)" : "var(--danger)";

  let justification = null;
  if (status === "Reprovado" && bobina !== "Acerto de Cor") {
    const lastStatus = await checkLastInspectionStatus("color_inspections", selectedcolor.name, op);

    if (lastStatus && lastStatus.toLowerCase() === "reprovado") {
      // MODAL OBRIGATÓRIO (Substitui prompt cancelável)
      justification = await showRequiredJustificationModal(
        "🚨 SEGUNDA REPROVAÇÃO CONSECUTIVA!",
        "Esta OP já teve uma reprovação anterior (ignorando acertos). Informe detalhadamente o que foi feito para corrigir o DELTA E:"
      );
    }
  }

  const dl = l2 - selectedcolor.l;
  const da = a2 - selectedcolor.a;
  const db = b2 - selectedcolor.b;

  document.getElementById("deltal").textContent = "Delta L: " + dl.toFixed(2) + (Math.abs(dl) > 2.0 ? " ⚠️" : "");
  document.getElementById("deltaa").textContent = "Delta A: " + da.toFixed(2) + (Math.abs(da) > 2.0 ? " ⚠️" : "");
  document.getElementById("deltab").textContent = "Delta B: " + db.toFixed(2) + (Math.abs(db) > 2.0 ? " ⚠️" : "");

  updateColorSample(document.getElementById("colorsamplesample"), l2, a2, b2);

  document.getElementById('diagnostico-btn').style.display = 'block';

  try {
    const { error } = await sb.from("color_inspections").insert([{
      product: selectedcolor.name, original_l: selectedcolor.l, original_a: selectedcolor.a, original_b: selectedcolor.b,
      inspected_l: l2, inspected_a: a2, inspected_b: b2, deltae: deltae.toFixed(2), status: status,
      bobina: bobina || null, op: op, justification: justification,
      matricula: matricula, colorista: coloristaNome
    }]);
    if (error) throw error;

    // Alerta customizado com aviso de deltas individuais > 1.0
    let successMsg = "Inspeção salva com sucesso!";
    let warnings = [];
    if (Math.abs(dl) > 2.0) warnings.push(`L (${dl.toFixed(2)})`);
    if (Math.abs(da) > 2.0) warnings.push(`A (${da.toFixed(2)})`);
    if (Math.abs(db) > 2.0) warnings.push(`B (${db.toFixed(2)})`);

    if (warnings.length > 0) {
      successMsg += "\n\nAtenção: Deltas individuais acima de 2.0:\n" + warnings.join(", ");
    }

    alert(successMsg);
  } catch (e) {
    alert("Erro ao salvar inspeção: " + e.message);
  }
}
// VARIAVEIS GLOBAIS DE PAGINACAO
let currentInspectionsOffset = 0;
const INSPECTIONS_PAGE_SIZE = 50;
let isSearchActive = false;

async function loadInitialInspections() {
  currentInspectionsOffset = 0;
  allInspectionsData = [];
  document.getElementById("databasebody").innerHTML = "";
  await loadInspections(0, false);
}

async function loadMoreInspections() {
  await loadInspections(currentInspectionsOffset, true);
}

async function loadInspections(offset, append) {
  const btnLoadMore = document.getElementById('btnLoadMore');
  if (btnLoadMore) {
    btnLoadMore.textContent = "Carregando...";
    btnLoadMore.disabled = true;
  }

  try {
    let query = sb
      .from("color_inspections")
      .select("*")
      .order('timestamp', { ascending: false });

    // Se a busca estiver ativa, não usamos o range padrão simples, mas a query construida
    // Porém, para simplificar e manter "loadMore" funcionando com busca, 
    // precisaríamos salvar os parametros de busca.
    // A estratégia aqui será: se isSearchActive for false, carrega paginado normal.
    // Se isSearchActive for true, 'searchdatabase' cuida de tudo?
    // Vamos permitir que 'loadMore' funcione também para busca sem filtros complexos por enquanto,
    // ou desativar loadMore se for busca complexa (but o usuario quer ver historico).

    // CORREÇÃO: Vamos fazer loadInspections lidar apenas com a carga "Default" (todo o historico).
    // Quando for pesquisa (searchdatabase), ela lida com a pesquisa.

    if (isSearchActive) {
      // Se estiver em modo pesquisa, loadMore deve chamar a logica de pesquisa com offset?
      // Para simplificar: searchdatabase faz a query. 
      // Vamos focar no caso principal: Carga inicial e historico.
      query = query.range(offset, offset + INSPECTIONS_PAGE_SIZE - 1);
    } else {
      query = query.range(offset, offset + INSPECTIONS_PAGE_SIZE - 1);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      if (!append) {
        allInspectionsData = data;
        document.getElementById("databasebody").innerHTML = "";
      } else {
        allInspectionsData = allInspectionsData.concat(data);
      }

      updateInspectionsTable(data, append);
      currentInspectionsOffset = offset + data.length;
    }

    // Configurar botão Carregar Mais
    if (btnLoadMore) {
      btnLoadMore.disabled = false;
      if (data && data.length < INSPECTIONS_PAGE_SIZE) {
        btnLoadMore.style.display = 'none';
      } else {
        btnLoadMore.style.display = 'inline-block';
        btnLoadMore.textContent = "Carregar Mais";
      }
    }

  } catch (e) {
    console.error(e);
    alert("Erro ao carregar dados: " + e.message);
    if (btnLoadMore) btnLoadMore.textContent = "Erro ao carregar";
  }
}

async function searchdatabase() {
  const searchTerm = document.getElementById("databasesearch").value.trim();
  const startDateString = document.getElementById("startDateFilter").value;
  const endDateString = document.getElementById("endDateFilter").value;

  const btnLoadMore = document.getElementById('btnLoadMore');

  // Se campos vazios e data vazia, volta ao normal
  if (!searchTerm && !startDateString && !endDateString) {
    isSearchActive = false;
    loadInitialInspections();
    return;
  }

  isSearchActive = true;
  document.getElementById("databasebody").innerHTML = '<tr><td colspan="13" style="text-align: center;">Pesquisando...</td></tr>';
  if (btnLoadMore) btnLoadMore.style.display = 'none';

  try {
    let query = sb.from("color_inspections").select("*").order('timestamp', { ascending: false });

    if (startDateString) {
      query = query.gte('timestamp', startDateString + 'T00:00:00');
    }
    if (endDateString) {
      query = query.lte('timestamp', endDateString + 'T23:59:59.999');
    }

    // Busca textual no Supabase (limitada). 
    // Supabase não tem um "search all fields" simples sem Full Text Search configurado no backend.
    // Vamos tentar filtrar pelos campos principais se houver termo.
    // Nota: .or() com filtros em colunas diferentes pode ser usado.
    if (searchTerm) {
      // Tenta identificar se é numero (OP)
      if (/^\d+$/.test(searchTerm)) {
        query = query.or(`op.eq.${searchTerm}, bobina.ilike.%${searchTerm}%, product.ilike.%${searchTerm}%`);
      } else {
        query = query.or(`product.ilike.%${searchTerm}%, bobina.ilike.%${searchTerm}%, status.ilike.%${searchTerm}%`);
      }
    }

    // Limitamos resultados da pesquisa a 100 para não travar, pois não implementamos paginacao na pesquisa ainda
    query = query.limit(100);

    const { data, error } = await query;
    if (error) throw error;

    allInspectionsData = data || []; // Atualiza cache local

    document.getElementById("databasebody").innerHTML = ""; // Limpa "Pesquisando..."
    updateInspectionsTable(data, false);

    // Na pesquisa customizada, escondemos o Load More por enquanto para simplificar
    // (ou mostramos msg se tiver 100 itens avisando que pode ter mais)
    if (btnLoadMore) btnLoadMore.style.display = 'none';

    if (data.length === 100) {
      // Opcional: Avisar usuario
    }

  } catch (e) {
    alert("Erro na pesquisa: " + e.message);
    document.getElementById("databasebody").innerHTML = "";
  }
}

function clearDatabaseFilters() {
  document.getElementById("databasesearch").value = "";
  document.getElementById("startDateFilter").value = "";
  document.getElementById("endDateFilter").value = "";
  isSearchActive = false;
  loadInitialInspections();
}

// append = false (substitui), true (adiciona)
function updateInspectionsTable(data, append = false) {
  const tablebody = document.getElementById("databasebody");

  if (!append) {
    tablebody.innerHTML = "";
  }

  if (!data || data.length === 0) {
    if (!append) {
      tablebody.innerHTML = `<tr><td colspan="13" style="text-align: center;">Nenhum resultado encontrado</td></tr>`;
    }
    return;
  }

  data.forEach(item => {
    let timestamp = item.timestamp || item.created_at;
    let formattedDate = "-";

    if (timestamp) {
      let dateStr = timestamp;
      if (typeof dateStr === 'string' && !dateStr.includes('Z') && !dateStr.includes('+')) {
        dateStr = dateStr.replace(' ', 'T') + 'Z';
      }
      formattedDate = new Date(dateStr).toLocaleString("pt-BR", { timeZone: 'America/Sao_Paulo' });
    }
    const statusClass = item.status === 'Aprovado' ? 'status-aprovado' : item.status === 'Reprovado' ? 'status-reprovado' : '';
    const productCode = (item.product || "").split('-')[0].trim();
    const description = productDescriptions[productCode] || "-";
    const row = document.createElement("tr");

    row.innerHTML = `<td>${item.product || '-'}</td>
                         <td>${description}</td>
                         <td>${item.original_l != null ? item.original_l.toFixed(2) : '-'}</td>
                         <td>${item.original_a != null ? item.original_a.toFixed(2) : '-'}</td>
                         <td>${item.original_b != null ? item.original_b.toFixed(2) : '-'}</td>
                         <td>${item.inspected_l != null ? item.inspected_l.toFixed(2) : '-'}</td>
                         <td>${item.inspected_a != null ? item.inspected_a.toFixed(2) : '-'}</td>
                         <td>${item.inspected_b != null ? item.inspected_b.toFixed(2) : '-'}</td>
                         <td>${item.deltae != null ? item.deltae : '-'}</td>
                         <td class="status-cell ${statusClass}">${item.status || '-'}</td>
                         <td>${formattedDate}</td>
                         <td>${item.bobina || '-'}</td>
                         <td>${item.op != null ? item.op : '-'}</td>
                         <td>
                           <button class="btn-small" title="Diagnóstico de Cor" onclick="analyzeInspectionInDiagnostic(
                     ${item.original_l ?? 0}, ${item.original_a ?? 0}, ${item.original_b ?? 0},
                     ${item.inspected_l ?? 0}, ${item.inspected_a ?? 0}, ${item.inspected_b ?? 0}
                   )">🔬</button>
                 </td>`;
    tablebody.appendChild(row);
  });
}

// ADICIONADO: Função para carregar Pantones
async function loadpantones() {
  if (pantonedb.length > 0) return;
  let allPantones = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;
  let totalCount = null;

  try {
    while (keepFetching) {
      const options = totalCount === null ? { count: 'exact' } : {};
      const { data, error, count } = await sb.from("pantone_standards")
        .select("*", options)
        .order('name')
        .range(offset, offset + batchSize - 1);

      if (error) throw error;

      if (totalCount === null && count !== null) totalCount = count;

      if (data && data.length > 0) {
        allPantones = allPantones.concat(data);
        if (data.length < batchSize || (totalCount !== null && allPantones.length >= totalCount)) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }
    pantonedb = allPantones;
    console.log("Pantones carregados:", pantonedb.length);
  } catch (e) {
    console.error("Erro ao carregar Pantones:", e);
    pantonedb = [];
  }
}

function searchPantones() {
  const query = document.getElementById("pantone-query").value.toLowerCase().trim();
  const resultsDiv = document.getElementById("pantone-results");
  resultsDiv.innerHTML = "";

  if (pantonedb.length === 0) {
    resultsDiv.innerHTML = "<p>Carregando base de dados Pantone...</p>";
    loadpantones().then(() => {
      if (pantonedb.length === 0) {
        resultsDiv.innerHTML = "<p>Erro ao carregar base de dados Pantone ou base vazia.</p>";
      } else {
        searchPantones(); // Tenta pesquisar novamente após carregar
      }
    });
    return;
  }

  const matches = !query ? pantonedb : pantonedb.filter(p => p.name.toLowerCase().includes(query));

  if (matches.length === 0) {
    resultsDiv.innerHTML = "Nenhum Pantone correspondente encontrado.";
    return;
  }

  // Limita a 50 resultados para performance
  const displayMatches = matches.slice(0, 50);

  displayMatches.forEach(match => {
    const valL = match.l !== undefined ? match.l : match.L;
    const valA = match.a;
    const valB = match.b;

    const matchdiv = document.createElement("div");
    matchdiv.classList.add("match");
    matchdiv.innerHTML = `
      <span>
        <strong>${match.name}</strong><br>
        <small style="color: #666;">L: ${valL.toFixed(2)} | a: ${valA.toFixed(2)} | b: ${valB.toFixed(2)}</small>
      </span>
      <div class="color-sample" style="background-color: lab(${valL}% ${valA} ${valB});"></div>
    `;
    resultsDiv.appendChild(matchdiv);
  });

  if (matches.length > 50) {
    const moreMsg = document.createElement("p");
    moreMsg.style.fontSize = "0.8rem";
    moreMsg.style.color = "#888";
    moreMsg.style.textAlign = "center";
    moreMsg.textContent = `Mostrando 50 de ${matches.length} resultados. Refine sua busca se necessário.`;
    resultsDiv.appendChild(moreMsg);
  }
}

async function loadproducts() {
  let allProducts = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;
  let totalCount = null;
  try {
    while (keepFetching) {
      const options = totalCount === null ? { count: 'exact' } : {};
      const { data, error, count } = await sb.from("products").select("*", options).order('name').range(offset, offset + batchSize - 1);
      if (error) { throw error; }
      if (totalCount === null && count !== null) { totalCount = count; }
      if (data && data.length > 0) {
        allProducts = allProducts.concat(data);
        if (data.length < batchSize || (totalCount !== null && allProducts.length >= totalCount)) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }
    productsdb = allProducts;
  } catch (catchError) {
    console.error("Erro ao carregar produtos:", catchError);
    alert("Erro ao carregar produtos: " + catchError.message);
    productsdb = [];
  }
  updateproductstable();
}
function updateproductstable() {
  const tablebody = document.getElementById("productsbody");
  if (!tablebody) return;
  tablebody.innerHTML = "";
  const productsToDisplay = productsdb;
  if (!productsToDisplay || productsToDisplay.length === 0) {
    tablebody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Nenhum produto cadastrado</td></tr>`;
    return;
  }
  productsToDisplay.forEach(product => {
    const productCode = product.name.split('-')[0].trim();
    const description = productDescriptions[productCode] || "-";
    const row = document.createElement("tr");
    row.id = "product-row-" + product.id;
    row.innerHTML = `
          <td>${product.name}</td>
          <td>${description}</td>
          <td>${product.l.toFixed(2)}</td>
          <td>${product.a.toFixed(2)}</td>
          <td>${product.b.toFixed(2)}</td>
          <td><div class="color-sample" style="background-color: lab(${product.l}% ${product.a} ${product.b});"></div></td>
          <td><button onclick="editproduct(${product.id})">Editar</button><button class="btn-danger" onclick="removeproduct(${product.id})">Remover</button></td>`;
    tablebody.appendChild(row);
  });
}
async function registernewproduct() {
  const name = document.getElementById("newproductname").value.trim();
  const l = parseFloat(document.getElementById("newproductl").value);
  const a = parseFloat(document.getElementById("newproducta").value);
  const b = parseFloat(document.getElementById("newproductb").value);
  if (!name || isNaN(l) || isNaN(a) || isNaN(b) || l < 0 || l > 100) { alert("Dados inválidos. Verifique nome e valores L(0-100), a, b."); return; }
  try {
    const { error } = await sb.from("products").insert([{ name, l, a, b }]);
    if (error) throw error;
    alert("Produto cadastrado com sucesso!");
    await loadproducts();
    document.getElementById("newproductname").value = "";
    document.getElementById("newproductl").value = "";
    document.getElementById("newproducta").value = "";
    document.getElementById("newproductb").value = "";
    updateColorSample(document.getElementById("newcolorpreview"), 0, 0, 0);
  } catch (e) {
    console.error("Erro ao inserir produto:", e);
    alert("Erro ao inserir produto: " + e.message);
  }
}
function editproduct(id) {
  const product = productsdb.find(p => p.id === id);
  if (!product) return;
  const row = document.getElementById("product-row-" + id);
  if (!row) return;
  row.dataset.originalName = product.name;
  row.dataset.originalL = product.l.toFixed(2);
  row.dataset.originalA = product.a.toFixed(2);
  row.dataset.originalB = product.b.toFixed(2);
  row.dataset.originalActions = row.cells[5].innerHTML;
  row.cells[0].innerHTML = `<input type="text" id="edit-name-${id}" value="${product.name}">`;
  row.cells[1].innerHTML = `<input type="number" step="0.01" id="edit-l-${id}" value="${product.l.toFixed(2)}">`;
  row.cells[2].innerHTML = `<input type="number" step="0.01" id="edit-a-${id}" value="${product.a.toFixed(2)}">`;
  row.cells[3].innerHTML = `<input type="number" step="0.01" id="edit-b-${id}" value="${product.b.toFixed(2)}">`;
  row.cells[5].innerHTML = `<button onclick="saveproductedit(${id})">Salvar</button><button class="btn-secondary" onclick="canceledit(${id})">Cancelar</button>`;
}
function canceledit(id) {
  const row = document.getElementById("product-row-" + id);
  if (!row || typeof row.dataset.originalName === 'undefined') return;
  row.cells[0].textContent = row.dataset.originalName;
  row.cells[1].textContent = row.dataset.originalL;
  row.cells[2].textContent = row.dataset.originalA;
  row.cells[3].textContent = row.dataset.originalB;
  row.cells[5].innerHTML = row.dataset.originalActions;
  delete row.dataset.originalName;
  delete row.dataset.originalL;
  delete row.dataset.originalA;
  delete row.dataset.originalB;
  delete row.dataset.originalActions;
}
async function saveproductedit(id) {
  const newName = document.getElementById("edit-name-" + id).value.trim();
  const newL = parseFloat(document.getElementById("edit-l-" + id).value);
  const newA = parseFloat(document.getElementById("edit-a-" + id).value);
  const newB = parseFloat(document.getElementById("edit-b-" + id).value);
  if (!newName || isNaN(newL) || isNaN(newA) || isNaN(newB) || newL < 0 || newL > 100) { alert("Dados inválidos."); return; }
  const { error } = await sb.from("products").update({ name: newName, l: newL, a: newA, b: newB }).eq("id", id);
  if (error) {
    alert("Erro ao atualizar produto: " + error.message);
    canceledit(id);
    return;
  }
  alert("Produto atualizado com sucesso!");
  await loadproducts();
}
async function removeproduct(id) {
  if (confirm("Tem certeza que deseja remover este produto?")) {
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) { alert("Erro ao remover produto: " + error.message); return; }
    await loadproducts();
  }
}
function searchproductsdb() {
  const searchTerm = document.getElementById("productsearch").value.trim();
  const filteredProducts = !searchTerm ? productsdb : productsdb.filter(p => p.name.toLowerCase().includes(searchTerm));
  const tablebody = document.getElementById("productsbody");
  tablebody.innerHTML = "";
  if (filteredProducts.length === 0) {
    tablebody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Nenhum produto encontrado</td></tr>`;
    return;
  }
  filteredProducts.forEach(product => {
    const productCode = product.name.split('-')[0].trim();
    const description = productDescriptions[productCode] || "-";
    const row = document.createElement("tr");
    row.id = "product-row-" + product.id;
    row.innerHTML = `<td>${product.name}</td>
                         <td>${description}</td>
                         <td>${product.l.toFixed(2)}</td>
                         <td>${product.a.toFixed(2)}</td>
                         <td>${product.b.toFixed(2)}</td>
                         <td><div class="color-sample" style="background-color: lab(${product.l}% ${product.a} ${product.b});"></div></td>
                         <td><button onclick="editproduct(${product.id})">Editar</button><button class="btn-danger" onclick="removeproduct(${product.id})">Remover</button></td>`;
    tablebody.appendChild(row);
  });
}

function analyzeInspectionInDiagnostic(l_orig, a_orig, b_orig, l_insp, a_insp, b_insp) {
  document.getElementById('l1_diag').value = l_orig;
  document.getElementById('a1_diag').value = a_orig;
  document.getElementById('b1_diag').value = b_orig;

  document.getElementById('l2_diag').value = l_insp;
  document.getElementById('a2_diag').value = a_insp;
  document.getElementById('b2_diag').value = b_insp;

  showTab('deltacalculator');

  runColorDiagnostic();
}

function labToLch(L, a, b) {
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return { l: L, c: C, h };
}
function getDiagnosticLabFromInput(prefix) {
  return {
    l: parseFloat(document.getElementById(`l${prefix}_diag`).value),
    a: parseFloat(document.getElementById(`a${prefix}_diag`).value),
    b: parseFloat(document.getElementById(`b${prefix}_diag`).value)
  };
}
function runColorDiagnostic() {
  const labPadrao = getDiagnosticLabFromInput('1');
  const labAmostra = getDiagnosticLabFromInput('2');

  const lchPadrao = labToLch(labPadrao.l, labPadrao.a, labPadrao.b);
  const lchAmostra = labToLch(labAmostra.l, labAmostra.a, labAmostra.b);

  const dL = lchAmostra.l - lchPadrao.l;
  const da = labAmostra.a - labPadrao.a;
  const db = labAmostra.b - labPadrao.b;
  const dC = lchAmostra.c - lchPadrao.c;

  let dh = lchAmostra.h - lchPadrao.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;

  const dE2000 = ciede2000(labPadrao.l, labPadrao.a, labPadrao.b, labAmostra.l, labAmostra.a, labAmostra.b);

  const diagnostico = {
    resumo: '',
    luminosidade: { diagnostico: '', acao: '' },
    croma: { diagnostico: '', acao: '' },
    matiz: { diagnostico: '', acao: '' }
  };

  if (dE2000 <= 1.0) {
    diagnostico.resumo = `🎯 <strong>Status: APROVADO.</strong> A diferença de cor (${dE2000.toFixed(2)}) é praticamente imperceptível.`;
  } else if (dE2000 <= 2.0) {
    diagnostico.resumo = `⚠️ <strong>Status: APROVAÇÃO COM RESSALVAS.</strong> Existe uma pequena diferença de cor (${dE2000.toFixed(2)}) que pode ser notada por um observador treinado.`;
  } else {
    diagnostico.resumo = `❌ <strong>Status: REJEITADO.</strong> A diferença de cor (${dE2000.toFixed(2)}) é clara e facilmente perceptível.`;
  }

  if (Math.abs(dL) < DIAGNOSTIC_TOLERANCE) {
    diagnostico.luminosidade.diagnostico = "✅ <strong>Luminosidade (L*):</strong> Correta.";
    diagnostico.luminosidade.acao = "<em>O nível de claridade/escuridão da amostra corresponde ao padrão.</em>";
  } else if (dL > 0) {
    diagnostico.luminosidade.diagnostico = `⬆️ <strong>Luminosidade (L*):</strong> A amostra está <strong>${dL.toFixed(2)}</strong> pontos <strong>MAIS CLARA</strong>. <em>Isso é indicado por um valor de ΔL* positivo.</em>`;
    diagnostico.luminosidade.acao = "<strong>Ação Sugerida:</strong> Para escurecer, aumente a concentração dos pigmentos na formulação. Uma alternativa é adicionar uma quantidade mínima de pigmento preto, mas com cautela, pois isso também irá reduzir drasticamente a saturação (Croma), tornando a cor mais 'suja'.";
  } else {
    diagnostico.luminosidade.diagnostico = `⬇️ <strong>Luminosidade (L*):</strong> A amostra está <strong>${Math.abs(dL).toFixed(2)}</strong> pontos <strong>MAIS ESCURA</strong>. <em>Isso é indicado por um valor de ΔL* negativo.</em>`;
    diagnostico.luminosidade.acao = "<strong>Ação Sugerida:</strong> Para clarear, reduza a concentração de pigmentos adicionando mais base ou diluente (extender). Isso diminui a densidade da cor. Adicionar pigmento branco também clareia, mas irá reduzir a saturação (Croma), resultando em um tom mais pastel.";
  }

  if (Math.abs(dC) < DIAGNOSTIC_TOLERANCE) {
    diagnostico.croma.diagnostico = "✅ <strong>Croma (C*):</strong> Correto.";
    diagnostico.croma.acao = "<em>A intensidade ou 'pureza' da cor está adequada.</em>";
  } else if (dC > 0) {
    diagnostico.croma.diagnostico = `⬆️ <strong>Croma (C*):</strong> A amostra está <strong>${dC.toFixed(2)}</strong> pontos <strong>MAIS VIVA / LIMPA</strong>. <em>Isso é indicado por um ΔC* positivo, mostrando maior saturação.</em>`;
    diagnostico.croma.acao = "<strong>Ação Sugerida:</strong> Para 'sujar' a cor e reduzir sua intensidade, adicione uma quantidade mínima da sua cor complementar, ou um pigmento de cinza neutro/preto.";
  } else {
    diagnostico.croma.diagnostico = `⬇️ <strong>Croma (C*):</strong> A amostra está <strong>${Math.abs(dC).toFixed(2)}</strong> pontos <strong>MAIS SUJA / APAGADA</strong>. <em>Isso é indicado por um ΔC* negativo, mostrando menor saturação.</em>`;
    diagnostico.croma.acao = "<strong>Ação Sugerida:</strong> Aumente a concentração do(s) pigmento(s) principal(is) da cor. Verifique também a pureza dos componentes; contaminação na base ou nos pigmentos pode causar perda de croma.";
  }

  if (Math.abs(dh) < DIAGNOSTIC_TOLERANCE) {
    diagnostico.matiz.diagnostico = "✅ <strong>Matiz (h):</strong> Correto.";
    diagnostico.matiz.acao = "<em>Não há desvio de tonalidade perceptível.</em>";
  } else {
    let tendencia = "";
    if (Math.abs(da) > Math.abs(db)) {
      tendencia = da > 0 ? "mais avermelhada" : "mais esverdeada";
    } else {
      tendencia = db > 0 ? "mais amarelada" : "mais azulada";
    }
    const correcao = `Para neutralizar o desvio, ajuste a proporção dos pigmentos da formulação. Identifique o(s) componente(s) que está(ão) causando a tendência <strong>${tendencia}</strong> e reduza sua concentração, ou reforce o(s) pigmento(s) da direção oposta.`;
    diagnostico.matiz.diagnostico = `🔄 <strong>Matiz (h):</strong> Desvio de <strong>${dh.toFixed(2)}°</strong>. <em>A tonalidade da amostra está ligeiramente <strong>${tendencia}</strong> em relação ao padrão.</em>`;
    diagnostico.matiz.acao = `<strong>Ação Sugerida:</strong> ${correcao}`;
  }

  document.getElementById('delta-info').innerHTML = `
        <p><strong>Diferença Total (ΔE₀₀): ${dE2000.toFixed(2)}</strong></p>
        <p><strong>Deltas LCH:</strong> ΔL*: ${dL.toFixed(2)}, ΔC*: ${dC.toFixed(2)}, Δh: ${dh.toFixed(2)}°</p>
        <p><strong>Deltas LAB:</strong> ΔL*: ${dL.toFixed(2)}, Δa*: ${da.toFixed(2)}, Δb*: ${db.toFixed(2)}</p>
      `;

  document.getElementById('diagnostico-texto').innerHTML = `
        <h3>Diagnóstico Técnico e Ação Recomendada</h3>
        <p>${diagnostico.resumo}</p>
        <hr style="border:0; border-top:1px solid #eee; margin: 15px 0;">
        <p>${diagnostico.luminosidade.diagnostico}<br><em>${diagnostico.luminosidade.acao}</em></p>
        <p>${diagnostico.croma.diagnostico}<br><em>${diagnostico.croma.acao}</em></p>
        <p>${diagnostico.matiz.diagnostico}<br><em>${diagnostico.matiz.acao}</em></p>
      `;

  document.getElementById('diagnostico-container').style.display = 'block';

  plotDiagnosticChart(lchPadrao, lchAmostra, labPadrao, labAmostra);
  updateDiagnosticPreviews();
}
function plotDiagnosticChart(lchPadrao, lchAmostra, labPadrao, labAmostra) {
  const labels = Array.from({ length: 360 }, (_, i) => i + '°');
  const toChartAngle = (mathAngle) => (450 - mathAngle) % 360;
  const hPadraoChart = toChartAngle(lchPadrao.h);
  const hAmostraChart = toChartAngle(lchAmostra.h);
  const dataPadrao = new Array(360).fill(null);
  dataPadrao[Math.round(hPadraoChart) % 360] = lchPadrao.c;
  const dataAmostra = new Array(360).fill(null);
  dataAmostra[Math.round(hAmostraChart) % 360] = lchAmostra.c;
  const data = {
    labels: labels,
    datasets: [{
      label: 'Padrão',
      data: dataPadrao,
      pointBackgroundColor: `lab(${labPadrao.l}% ${labPadrao.a} ${labPadrao.b})`,
      pointBorderColor: '#000',
      pointRadius: 10,
      pointHoverRadius: 12,
      borderColor: 'rgba(0,0,0,0.5)',
      backgroundColor: 'rgba(0,0,0,0)'
    }, {
      label: 'Amostra',
      data: dataAmostra,
      pointBackgroundColor: `lab(${labAmostra.l}% ${labAmostra.a} ${labAmostra.b})`,
      pointBorderColor: '#fff',
      pointRadius: 8,
      pointHoverRadius: 10,
      borderColor: 'rgba(255,0,0,0.5)',
      backgroundColor: 'rgba(0,0,0,0)'
    }]
  };
  const options = {
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 140, beginAtZero: true,
        ticks: { stepSize: 20, backdropColor: 'rgba(255, 255, 255, 0.75)', fontFamily: "'JetBrains Mono', monospace" },
        angleLines: { color: 'rgba(0, 0, 0, 0.2)' },
        grid: { color: 'rgba(0, 0, 0, 0.2)' },
        pointLabels: { display: false }
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { family: "'Poppins', sans-serif" },
          generateLabels: function (chart) {
            const originalLabels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
            originalLabels.forEach((label, i) => {
              const dataset = chart.data.datasets[i];
              if (dataset && dataset.pointBackgroundColor) {
                label.fillStyle = dataset.pointBackgroundColor;
                label.strokeStyle = '#333';
              }
            });
            return originalLabels;
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const lch = context.dataset.label === 'Padrão' ? lchPadrao : lchAmostra;
            return `C*: ${lch.c.toFixed(2)}, h: ${lch.h.toFixed(2)}°`;
          }
        }
      }
    }
  };
  if (diagnosticChartInstance) diagnosticChartInstance.destroy();
  const ctx = document.getElementById('lchChart').getContext('2d');
  diagnosticChartInstance = new Chart(ctx, { type: 'radar', data: data, options: options });
}
function updateDiagnosticPreviews() {
  const labPadrao = getDiagnosticLabFromInput('1');
  const labAmostra = getDiagnosticLabFromInput('2');
  document.getElementById('preview-padrao').style.backgroundColor = `lab(${labPadrao.l}% ${labPadrao.a} ${labPadrao.b})`;
  document.getElementById('preview-amostra').style.backgroundColor = `lab(${labAmostra.l}% ${labAmostra.a} ${labAmostra.b})`;
}

function findbestmatches() {
  const l1 = parseFloat(document.getElementById("l1").value);
  const a1 = parseFloat(document.getElementById("a1").value);
  const b1 = parseFloat(document.getElementById("b1").value);
  const resultsDiv = document.getElementById("bestmatches");
  resultsDiv.innerHTML = "";

  if (isNaN(l1) || isNaN(a1) || isNaN(b1) || l1 < 0 || l1 > 100) {
    alert("Valores L, a, b de entrada inválidos."); return;
  }

  // Combina as duas listas
  let allCandidates = [];

  // Adiciona Produtos
  if (productsdb && productsdb.length > 0) {
    productsdb.forEach(p => {
      allCandidates.push({
        name: p.name,
        l: p.l, a: p.a, b: p.b,
        source: 'product' // Marca como Produto
      });
    });
  }

  // Adiciona Pantones
  if (pantonedb && pantonedb.length > 0) {
    pantonedb.forEach(p => {
      // Tenta ler L/l, pois o banco pode estar com maiúscula ou minúscula
      const valL = p.l !== undefined ? p.l : p.L;
      const valA = p.a;
      const valB = p.b;

      if (valL != null && valA != null && valB != null) {
        allCandidates.push({
          name: p.name,
          l: valL, a: valA, b: valB,
          source: 'pantone' // Marca como Pantone
        });
      }
    });
  }

  if (allCandidates.length === 0) {
    resultsDiv.innerHTML = "Nenhuma base de dados carregada (Produtos ou Pantone)."; return;
  }

  // Calcula Delta E para todos e ordena
  let matches = allCandidates.map(item => ({
    item,
    deltae: ciede2000(l1, a1, b1, item.l, item.a, item.b)
  })).sort((a, b) => a.deltae - b.deltae);

  // Pega apenas os top 20 para não travar a tela se tiver muitos
  matches = matches.slice(0, 20);

  if (matches.length === 0) { resultsDiv.innerHTML = "Nenhuma correspondência encontrada."; return; }

  matches.forEach(match => {
    const matchdiv = document.createElement("div");
    matchdiv.classList.add("match");
    matchdiv.dataset.deltaeGood = match.deltae <= 2;

    // Define a classe e o texto da tag
    const tagClass = match.item.source === 'product' ? 'tag-product' : 'tag-pantone';
    const tagText = match.item.source === 'product' ? 'PRODUTO' : 'PANTONE';

    matchdiv.innerHTML = `
            <span>
                ${match.item.name} 
                <span class="tag-source ${tagClass}">${tagText}</span>
                (ΔE = ${match.deltae.toFixed(2)})
            </span>
            <div class="color-sample" style="background-color: lab(${match.item.l}% ${match.item.a} ${match.item.b});"></div>
        `;
    resultsDiv.appendChild(matchdiv);
  });
}
function updateinputcolorsample() {
  const l1 = parseFloat(document.getElementById("l1").value) || 0;
  const a1 = parseFloat(document.getElementById("a1").value) || 0;
  const b1 = parseFloat(document.getElementById("b1").value) || 0;
  updateColorSample(document.getElementById("bestmatch-input-sample"), l1, a1, b1);
}

const processControlStandards = {
  densities: [],
  tva50: [
    { color: 'Cyan', id_prefix: 'tva_c50', min: 64, target: 69, max: 74 },
    { color: 'Magenta', id_prefix: 'tva_m50', min: 64, target: 69, max: 74 },
    { color: 'Yellow', id_prefix: 'tva_y50', min: 64, target: 69, max: 74 },
    { color: 'Black', id_prefix: 'tva_k50', min: 64, target: 69, max: 74 }
  ],
  opacity: [
    { item: 'Opacidade Tinta Branca', id_prefix: 'opacity_white', min: 50, target: 52, max: 56 }
  ]
};
function populateProfileSelector() {
  const selector = document.getElementById('pc_profile_select');
  selector.innerHTML = '<option value="">-- Selecione um Perfil --</option>';
  if (typeof allProfileData === 'undefined' || Object.keys(allProfileData).length === 0) {
    console.error("A variável 'allProfileData' não foi carregada. Verifique o arquivo profiles.js e a sua conexão.");
    return;
  }
  Object.keys(allProfileData).sort().forEach(profileName => {
    const option = document.createElement('option');
    option.value = profileName;
    option.textContent = profileName;
    selector.appendChild(option);
  });
}
async function loadProcessStandardsForProduct(productCode) {
  const profileNoteDensities = document.getElementById('current_profile_note_densities');
  const cardsWrapper = document.getElementById('inspection_cards_wrapper');
  cardsWrapper.innerHTML = '';

  if (!productCode) {
    profileNoteDensities.textContent = 'Digite o código do produto para carregar os padrões.';
    return;
  }

  try {
    const { data, error } = await sb.from("process_standards").select("*").eq("product_code", productCode);
    if (error || !data || data.length === 0) {
      profileNoteDensities.textContent = `Padrão não encontrado para o código: ${productCode}`;
      profileNoteDensities.style.color = 'var(--danger)';
      return;
    }

    processControlStandards.densities = [];
    processControlStandards.tva50 = [];
    processControlStandards.opacity = [];

    const safeFix = (val, prec) => (val !== null && val !== undefined && !isNaN(val)) ? val.toFixed(prec) : "-";

    data.forEach((row, index) => {
      // Pega opacidade apenas do primeiro registro ou se for o Branco
      if (index === 0) {
        processControlStandards.opacity = [
          {
            item: 'Opacidade Tinta Branca',
            id_prefix: 'opacity_white',
            min: row.opac_min,
            target: row.opac_target,
            max: row.opac_max
          }
        ];
      }

      const idSuffix = row.color_name.toLowerCase().replace(/\s+/g, '_');
      const equipInfo = `ANILOX: ${row.anilox || '-'} | Nº: ${row.anilox_num || '-'} | Dupla Face: ${row.dupla_face || '-'}`;

      processControlStandards.densities.push({
        color: row.color_name,
        id_prefix: `dens_${idSuffix}`,
        min: row.dens_min,
        target: row.dens_target,
        max: row.dens_max,
        anilox: row.anilox,
        anilox_num: row.anilox_num,
        dupla_face: row.dupla_face
      });

      processControlStandards.tva50.push({
        color: row.color_name,
        id_prefix: `tva_${idSuffix}`,
        min: row.tva_min,
        target: row.tva_target,
        max: row.tva_max
      });

      // Gerar Cartão de Inspeção Premium
      const card = document.createElement('div');
      card.className = 'inspection-card pending';
      card.id = `inspection_card_${idSuffix}`;

      let headerClass = `card-${row.color_name.toLowerCase()}`;
      // Map standard names to our CSS classes if they match
      if (['cyan', 'magenta', 'yellow', 'black'].includes(row.color_name.toLowerCase())) {
        card.classList.add(`card-border-${row.color_name.toLowerCase()}`); // Optional: add border color
      } else {
        card.classList.add('card-border-special');
      }

      card.innerHTML = `
        <div class="inspection-card-header" style="background: var(--${row.color_name.toLowerCase()}, #7f8c8d)">
          <div class="color-name"><i class="fas fa-palette"></i> ${row.color_name}</div>
          <div class="status-indicator" id="status_label_${idSuffix}">Pendente</div>
        </div>
        <div class="inspection-card-body">
          <div class="inspection-section">
            <div class="inspection-section-title"><i class="fas fa-tint"></i> Densitometria</div>
            <div class="inspection-row">
              <div class="inspection-field">
                <label>Alvo: ${safeFix(row.dens_min, 2)} - ${safeFix(row.dens_max, 2)}</label>
                <div class="target-val">${safeFix(row.dens_target, 2)}</div>
              </div>
              <div class="inspection-field">
                <label>Medido</label>
                <input type="number" step="0.01" id="dens_${idSuffix}_measured" placeholder="0.00" 
                  oninput="updateInspectionStatus('${idSuffix}')">
              </div>
            </div>
          </div>

          <div class="inspection-section">
            <div class="inspection-section-title"><i class="fas fa-chart-line"></i> TVA % (50%)</div>
            <div class="inspection-row">
              <div class="inspection-field">
                <label>Alvo: ${safeFix(row.tva_min, 1)}% - ${safeFix(row.tva_max, 1)}%</label>
                <div class="target-val">${safeFix(row.tva_target, 1)}%</div>
              </div>
              <div class="inspection-field">
                <label>Medido (%)</label>
                <input type="number" step="0.1" id="tva_${idSuffix}_measured" placeholder="0.0"
                  oninput="updateInspectionStatus('${idSuffix}')">
              </div>
            </div>
          </div>
        </div>
        <div class="inspection-card-footer">
          <i class="fas fa-info-circle"></i> ${equipInfo}
        </div>
      `;
      cardsWrapper.appendChild(card);
    });

    populateFixedTables(); // Agora gera o cartão de opacidade
    profileNoteDensities.textContent = `Padrões carregados para o produto: ${productCode}`;
    profileNoteDensities.style.color = 'var(--text-light)';

  } catch (e) {
    console.error("Erro ao carregar padrões:", e);
    profileNoteDensities.textContent = "Erro ao buscar padrões no banco de dados.";
  }
}

function updateInspectionStatus(idSuffix) {
  const densInput = document.getElementById(`dens_${idSuffix}_measured`);
  const tvaInput = document.getElementById(`tva_${idSuffix}_measured`);
  const card = document.getElementById(`inspection_card_${idSuffix}`);
  const statusLabel = document.getElementById(`status_label_${idSuffix}`);

  if (!densInput || !tvaInput || !card) return;

  const densVal = parseFloat(densInput.value);
  const tvaVal = parseFloat(tvaInput.value);

  // Encontrar os padrões corretos
  const densStd = processControlStandards.densities.find(d => d.id_prefix === `dens_${idSuffix}`);
  const tvaStd = processControlStandards.tva50.find(t => t.id_prefix === `tva_${idSuffix}`);

  if (isNaN(densVal) && isNaN(tvaVal)) {
    card.className = 'inspection-card pending';
    statusLabel.textContent = 'Pendente';
    return;
  }

  let densPass = true;
  if (!isNaN(densVal)) {
    densPass = (densVal >= densStd.min && densVal <= densStd.max);
  }

  let tvaPass = true;
  if (!isNaN(tvaVal)) {
    tvaPass = (tvaVal >= tvaStd.min && tvaVal <= tvaStd.max);
  }

  if (densPass && tvaPass) {
    card.className = 'inspection-card pass';
    statusLabel.textContent = 'OK';
  } else {
    card.className = 'inspection-card fail';
    statusLabel.textContent = 'Fora do Padrão';
  }
}

function populateFixedTables() {
  const wrapper = document.getElementById('opacity_inspection_wrapper');
  wrapper.innerHTML = '';
  const safeFix = (val, prec) => (val !== null && val !== undefined && !isNaN(val)) ? val.toFixed(prec) : "-";

  processControlStandards.opacity.forEach(item => {
    const card = document.createElement('div');
    card.className = 'inspection-card pending';
    card.id = `inspection_card_opacity`;
    card.style.maxWidth = "400px";
    card.style.margin = "0 auto";

    card.innerHTML = `
      <div class="inspection-card-header" style="background: #2c3e50">
        <div class="color-name"><i class="fas fa-eye-slash"></i> Opacidade do Branco</div>
        <div class="status-indicator" id="status_label_opacity">Pendente</div>
      </div>
      <div class="inspection-card-body">
        <div class="inspection-section">
          <div class="inspection-section-title"><i class="fas fa-percentage"></i> Medição de Opacidade</div>
          <div class="inspection-row">
            <div class="inspection-field">
              <label>Alvo: ${safeFix(item.min, 0)}% - ${safeFix(item.max, 0)}%</label>
              <div class="target-val">${safeFix(item.target, 0)}%</div>
            </div>
            <div class="inspection-field">
              <label>Medido (%)</label>
              <input type="number" step="0.1" id="${item.id_prefix}_measured" placeholder="0.0"
                oninput="updateOpacityStatus()">
            </div>
          </div>
        </div>
      </div>
    `;
    wrapper.appendChild(card);
  });
}

function updateOpacityStatus() {
  const input = document.getElementById('opacity_white_measured');
  const card = document.getElementById('inspection_card_opacity');
  const statusLabel = document.getElementById('status_label_opacity');

  if (!input || !card) return;

  const val = parseFloat(input.value);
  const std = processControlStandards.opacity[0];

  if (isNaN(val)) {
    card.className = 'inspection-card pending';
    statusLabel.textContent = 'Pendente';
    return;
  }

  if (val >= std.min && val <= std.max) {
    card.className = 'inspection-card pass';
    statusLabel.textContent = 'OK';
  } else {
    card.className = 'inspection-card fail';
    statusLabel.textContent = 'Fora do Padrão';
  }
}
async function handleVerificationAndSave() {
  const button = document.getElementById('verifyAndSaveButton');
  const globalMessage = document.getElementById('processControlGlobalMessage');
  const productName = document.getElementById('pc_product_name').value.trim();
  const opNumber = document.getElementById('pc_op_number').value.trim();
  const daughterCoilId = document.getElementById('pc_daughter_coil_id').value.trim();

  let overallStatusIsGood = true;
  let anyFieldFilled = false;
  globalMessage.textContent = '';
  globalMessage.style.display = 'none';

  // Validação de Campos Obrigatórios de Rastreabilidade
  if (!productName || !opNumber || !daughterCoilId) {
    globalMessage.textContent = 'Erro: Produto, OP e ID da Bobina são obrigatórios para salvar a inspeção.';
    globalMessage.style.color = 'var(--active-red)';
    globalMessage.style.display = 'block';
    return;
  }

  const getMeasurement = (id) => {
    const input = document.getElementById(id);
    if (!input || input.value.trim() === '') return { value: null, filled: false };
    anyFieldFilled = true;
    const num = parseFloat(input.value.replace(',', '.'));
    return { value: num, filled: true };
  };

  // 1. Validar Cores (Densidade e TVA)
  processControlStandards.densities.forEach(densityItem => {
    const tvaItem = processControlStandards.tva50.find(t => t.id_prefix === `tva_${densityItem.id_prefix.split('_')[1]}`);
    const idSuffix = densityItem.id_prefix.split('_')[1];

    const densMeasurement = getMeasurement(`dens_${idSuffix}_measured`);
    const tvaMeasurement = getMeasurement(`tva_${idSuffix}_measured`);

    let densPass = true;
    if (densMeasurement.filled) {
      densPass = (densMeasurement.value >= densityItem.min && densMeasurement.value <= densityItem.max);
    }

    let tvaPass = true;
    if (tvaMeasurement.filled) {
      tvaPass = (tvaMeasurement.value >= tvaItem.min && tvaMeasurement.value <= tvaItem.max);
    }

    if (densMeasurement.filled || tvaMeasurement.filled) {
      if (!densPass || !tvaPass) {
        overallStatusIsGood = false;
      }
    }
  });

  // 2. Validar Opacidade
  processControlStandards.opacity.forEach(item => {
    const opacityMeasurement = getMeasurement(`${item.id_prefix}_measured`);
    if (opacityMeasurement.filled) {
      const opacityOk = (opacityMeasurement.value >= item.min && opacityMeasurement.value <= item.max);
      if (!opacityOk) overallStatusIsGood = false;
    }
  });

  if (!anyFieldFilled) {
    globalMessage.textContent = 'Nenhum valor medido informado para verificação.';
    globalMessage.style.color = 'var(--text-light)';
    globalMessage.style.display = 'block';
    return;
  }

  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SALVANDO...';

  const getNumericValue = (id) => {
    const el = document.getElementById(id);
    if (!el || el.value.trim() === '') return null;
    return parseFloat(el.value.replace(',', '.'));
  };

  const pcMatricula = document.getElementById('pc_matricula').value.trim() || null;
  const pcColoristaInfo = pcMatricula ? coloristasDb[pcMatricula] : null;
  const pcColoristaNome = pcColoristaInfo ? pcColoristaInfo.nome : null;

  const inspectionData = {
    perfil_densidade: "PADRÃO DINÂMICO",
    produto: productName,
    op_number: opNumber,
    bobina_filha_id: daughterCoilId,
    status_geral: overallStatusIsGood ? 'APROVADO' : 'REPROVADO',
    matricula: pcMatricula,
    colorista: pcColoristaNome,
    // Mapeamento legado
    densidade_c_medido: getNumericValue('dens_cyan_measured'),
    densidade_m_medido: getNumericValue('dens_magenta_measured'),
    densidade_y_medido: getNumericValue('dens_yellow_measured'),
    densidade_k_medido: getNumericValue('dens_black_measured'),
    tva_c_medido: getNumericValue('tva_cyan_measured'),
    tva_m_medido: getNumericValue('tva_magenta_measured'),
    tva_y_medido: getNumericValue('tva_yellow_measured'),
    tva_k_medido: getNumericValue('tva_black_measured'),
    opacidade_branco_medido: getNumericValue('opacity_white_measured'),
    // Dados Dinâmicos
    medicoes_json: processControlStandards.densities.map(d => {
      const suf = d.id_prefix.split('_')[1];
      return {
        cor: d.color,
        dens: getNumericValue(`dens_${suf}_measured`),
        tva: getNumericValue(`tva_${suf}_measured`),
        anilox: d.anilox,
        dupla: d.dupla_face
      };
    })
  };

  if (inspectionData.status_geral === 'REPROVADO') {
    const lastStatus = await checkLastInspectionStatus("inspecoes_processo", productName, opNumber);

    if (lastStatus === 'REPROVADO') {
      // MODAL OBRIGATÓRIO DE PROCESSO
      inspectionData.justification = await showRequiredJustificationModal(
        "🚨 SEGUNDA REPROVAÇÃO DE PROCESSO!",
        "Esta OP já teve uma reprovação de processo anterior. Descreva a ação tomada para corrigir os valores de Densidade/TVA:"
      );
    }
  }

  try {
    const { error } = await sb.from('inspecoes_processo').insert([inspectionData]);
    if (error) throw error;

    globalMessage.innerHTML = `<i class="fas fa-check-circle"></i> INSPEÇÃO SALVA COM SUCESSO! Status: ${inspectionData.status_geral}`;
    globalMessage.style.color = overallStatusIsGood ? 'var(--success)' : 'var(--active-red)';
    globalMessage.style.display = 'block';

    // Resetar campos de medição após salvar
    document.querySelectorAll('.inspection-card input').forEach(inp => inp.value = '');
    document.querySelectorAll('.inspection-card').forEach(card => {
      card.className = 'inspection-card pending';
      const lbl = card.querySelector('.status-indicator');
      if (lbl) lbl.textContent = 'Pendente';
    });

  } catch (e) {
    globalMessage.innerHTML = `<i class="fas fa-exclamation-triangle"></i> FALHA AO SALVAR: ${e.message}`;
    globalMessage.style.color = 'var(--danger)';
    globalMessage.style.display = 'block';
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-check-double"></i> VERIFICAR E SALVAR INSPEÇÃO';
  }
}
async function fetchAndDisplayProcessInspections() {
  const tbody = document.getElementById('inspectionsTbody');
  if (!tbody) return;

  const searchTerm = document.getElementById('hist_process_search')?.value.trim();
  const startDate = document.getElementById('hist_process_start')?.value;
  const endDate = document.getElementById('hist_process_end')?.value;

  tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;">Buscando dados...</td></tr>';

  try {
    let query = sb.from('inspecoes_processo').select('*');

    // Filtro de Data
    if (startDate) {
      query = query.gte('created_at', startDate + 'T00:00:00Z');
    }
    if (endDate) {
      query = query.lte('created_at', endDate + 'T23:59:59Z');
    }

    // Filtro de Termo (Produto ou OP)
    // Nota: Como o Supabase não suporta OR complexo facilmente com query builder em colunas diferentes sem rpc ou filtros manuais no JS
    // vamos filtrar o produto/op no JS se o volume for razoável,
    // ou usaremos a sintaxe de filtro or se disponível.

    if (searchTerm) {
      // Se houver termo, tentamos filtrar por produto ou op_number
      query = query.or(`produto.ilike.%${searchTerm}%,op_number.ilike.%${searchTerm}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;">Nenhuma inspeção encontrada.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.forEach(item => {
      const row = tbody.insertRow();
      const statusClass = item.status_geral === 'APROVADO' ? 'status-aprovado' : 'status-reprovado';
      const formatValue = (value) => (value !== null && value !== undefined) ? value : '-';

      let timestamp = item.created_at;
      let formattedDate = "-";

      if (timestamp) {
        let dateStr = timestamp;
        if (typeof dateStr === 'string' && !dateStr.includes('Z') && !dateStr.includes('+')) {
          dateStr = dateStr.replace(' ', 'T') + 'Z';
        }
        formattedDate = new Date(dateStr).toLocaleString("pt-BR", { timeZone: 'America/Sao_Paulo' });
      }

      const productFull = item.produto || "";
      const productCode = productFull.split('-')[0].trim();
      const description = productDescriptions[productCode] || "-";

      // Lógica para Cores Especiais (se houver no JSON)
      let specialsHtml = "";
      if (item.medicoes_json) {
        try {
          const mJson = typeof item.medicoes_json === 'string' ? JSON.parse(item.medicoes_json) : item.medicoes_json;
          const specials = mJson.filter(m => !['Cyan', 'Magenta', 'Yellow', 'Black'].includes(m.cor));
          specialsHtml = specials.map(s => `<br><small>${s.cor}: ${formatValue(s.dens)} / ${formatValue(s.tva)}%</small>`).join('');
        } catch (e) { console.error("Erro parse json regioes:", e); }
      }

      row.innerHTML = `
        <td>${formattedDate}</td>
        <td>${formatValue(item.op_number)}</td>
        <td><b>${formatValue(item.produto)}</b>${specialsHtml}</td>
        <td><small>${description}</small></td>
        <td>${formatValue(item.bobina_filha_id)}</td>
        <td class="status-cell ${statusClass}">${formatValue(item.status_geral)}</td>
        <td>${formatValue(item.densidade_c_medido)}</td>
        <td>${formatValue(item.densidade_m_medido)}</td>
        <td>${formatValue(item.densidade_y_medido)}</td>
        <td>${formatValue(item.densidade_k_medido)}</td>
        <td>${formatValue(item.tva_c_medido)}</td>
        <td>${formatValue(item.tva_m_medido)}</td>
        <td>${formatValue(item.tva_y_medido)}</td>
        <td>${formatValue(item.tva_k_medido)}</td>
        <td>${formatValue(item.opacidade_branco_medido)}%</td>
      `;
    });

  } catch (err) {
    console.error("Erro ao buscar histórico de inspeções:", err);
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color: var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

function clearProcessFilters() {
  const searchInput = document.getElementById('hist_process_search');
  const startInput = document.getElementById('hist_process_start');
  const endInput = document.getElementById('hist_process_end');

  if (searchInput) searchInput.value = "";
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";

  fetchAndDisplayProcessInspections();
}

const HUE_START = 120, HUE_END = 0, SATURATION = "75%", LIGHTNESS_GOOD = "88%", LIGHTNESS_BAD = "75%";
const DELTAE_MAX_FOR_COLOR = 6.0, DELTAE_APPROVED_THRESHOLD = 2.0;
function getDates() {
  const s = document.getElementById("reportStartDate").value;
  const e = document.getElementById("reportEndDate").value;
  const reportPeriodDiv = document.getElementById("reportPeriod");
  if (!s || !e) {
    reportPeriodDiv.innerHTML = '<span class="error">Selecione data inicial e final.</span>';
    return null;
  }
  const sd = new Date(s + "T00:00:00");
  const ed = new Date(e + "T23:59:59.999");
  if (isNaN(sd) || isNaN(ed) || ed < sd) {
    reportPeriodDiv.innerHTML = '<span class="error">Período de datas inválido.</span>';
    return null;
  }
  const opts = { day: "2-digit", month: "2-digit", year: "numeric" };
  reportPeriodDiv.textContent = `Período: ${sd.toLocaleDateString("pt-BR", opts)} a ${ed.toLocaleDateString("pt-BR", opts)}`;
  return { sd, ed };
}
async function fetchReportData(sdISO, edISO, opFilter) {
  let allData = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;

  try {
    while (keepFetching) {
      let query = sb.from("color_inspections")
        .select("product, deltae, bobina, op, timestamp, original_l, original_a, original_b, inspected_l, inspected_a, inspected_b, justification, matricula, colorista")
        .gte("timestamp", sdISO)
        .lte("timestamp", edISO);
      
      if (opFilter !== null) query = query.eq("op", opFilter);
      
      // Ordenação consistente para paginação
      query = query.order("product").order("timestamp", { ascending: true })
                   .range(offset, offset + batchSize - 1);
      
      const { data, error } = await query;
      if (error) throw error;
      
      if (data && data.length > 0) {
        allData = allData.concat(data);
        if (data.length < batchSize) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }
    return allData;
  } catch (e) {
    console.error("Erro ao buscar dados do relatório de cor:", e);
    throw e;
  }
}
function getDeltaEColor(deltae) {
  if (isNaN(deltae) || deltae === null) return "#e0e0e0";
  const normalized = Math.min(Math.max(deltae, 0), DELTAE_MAX_FOR_COLOR) / DELTAE_MAX_FOR_COLOR;
  const hue = HUE_START * (1 - normalized);
  const lGood = parseFloat(LIGHTNESS_GOOD);
  const lBad = parseFloat(LIGHTNESS_BAD);
  const lightness = lGood + (lBad - lGood) * normalized;
  return `hsl(${hue}, ${SATURATION}, ${lightness}%)`;
}
function getTextColor(bgColor) {
  try {
    const match = bgColor.match(/hsl\(\s*\d+\s*,\s*\d+%?\s*,\s*(\d+)%?\s*\)/i);
    if (match && match[1]) return parseInt(match[1], 10) > 65 ? "#333333" : "#ffffff";
  } catch (e) { }
  return "#333333";
}
function groupAndStats(inspections) {
  const grouped = {};
  let total = 0, approved = 0, rejected = 0;
  inspections.forEach(item => {
    const prod = item.product || "Não especificado";
    if (!grouped[prod]) grouped[prod] = [];
    grouped[prod].push(item);
    const d = parseFloat(item.deltae);
    
    total++;
    if (!isNaN(d)) {
      if (d <= DELTAE_APPROVED_THRESHOLD) {
        approved++;
      } else {
        rejected++;
      }
    } else {
      rejected++;
    }
  });
  return { grouped, total, approved, rejected };
}
function resetStats() {
  document.getElementById("statTotalValue").textContent = "-";
  document.getElementById("statApprovedValue").textContent = "-";
  document.getElementById("statRejectedValue").textContent = "-";
  document.getElementById("statRateValue").textContent = "-%";
  document.getElementById("downloadExcelBtn").disabled = true;
  populateColorDropdown([]);
  document.getElementById("histogramBtn").disabled = true;
  if (histogramChartInstance) {
    histogramChartInstance.destroy();
    histogramChartInstance = null;
  }
}
function fillStats(total, approved, rejected) {
  document.getElementById("statTotalValue").textContent = total;
  document.getElementById("statApprovedValue").textContent = approved;
  document.getElementById("statRejectedValue").textContent = rejected;
  const rate = total > 0 ? (approved / total) * 100 : 0;
  document.getElementById("statRateValue").textContent = rate.toFixed(1) + "%";
  document.getElementById("downloadExcelBtn").disabled = false;
}
function renderProducts(groupedData) {
  const resultsAreaDiv = document.getElementById("resultsArea");
  resultsAreaDiv.innerHTML = "";
  const products = Object.keys(groupedData).sort();
  if (products.length === 0) {
    resultsAreaDiv.innerHTML = `<div class="placeholder-message">Nenhum produto encontrado.</div>`;
    populateColorDropdown([]);
    document.getElementById("histogramBtn").disabled = true;
    return;
  }
  populateColorDropdown(products);
  document.getElementById("histogramBtn").disabled = false;
  products.forEach(prod => {
    const section = document.createElement("div");
    section.className = "product-group";
    section.innerHTML = `<h3>${prod}</h3><div class="inspection-items"></div>`;
    const itemsContainer = section.querySelector('.inspection-items');
    groupedData[prod].forEach(item => {
      const card = document.createElement("div");
      card.className = "inspection-item";
      const d = parseFloat(item.deltae);
      const bg = getDeltaEColor(d);
      card.style.backgroundColor = bg;
      card.style.color = getTextColor(bg);
      // MODIFICAÇÃO: Correção do fuso horário para Brasília
      const displayDate = item.timestamp ? new Date(item.timestamp).toLocaleDateString("pt-BR", { timeZone: 'America/Sao_Paulo' }) : "-";
      card.title = `Bobina: ${item.bobina || "-"}\nOP: ${item.op ?? "-"}\nData: ${displayDate}\nΔE: ${isNaN(d) ? "-" : d.toFixed(2)}`;
      card.innerHTML = `<span class="item-deltae">${isNaN(d) ? "-" : d.toFixed(2)}</span><span class="item-detail">Bobina: ${item.bobina || "N/A"}</span>`;
      itemsContainer.appendChild(card);
    });
    resultsAreaDiv.appendChild(section);
  });
}
function populateProfileSelector() {
  const selector = document.getElementById('hist_profile_select');
  if (!selector) return;
  selector.innerHTML = '<option value="">Selecione um perfil para consultar...</option>';
  const profiles = Object.keys(allProfileData).sort();
  profiles.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selector.appendChild(option);
  });
}

function showHistoricalProfile(profileName) {
  const detailsDiv = document.getElementById('historical-profile-details');
  const tbody = document.getElementById('hist_profile_tbody');

  if (!profileName || !allProfileData[profileName]) {
    detailsDiv.style.display = 'none';
    return;
  }

  const p = allProfileData[profileName].densities;
  tbody.innerHTML = `
    <tr><td>Cyan</td><td>${p.cyan.min.toFixed(2)}</td><td>${p.cyan.target.toFixed(2)}</td><td>${p.cyan.max.toFixed(2)}</td></tr>
    <tr><td>Magenta</td><td>${p.magenta.min.toFixed(2)}</td><td>${p.magenta.target.toFixed(2)}</td><td>${p.magenta.max.toFixed(2)}</td></tr>
    <tr><td>Yellow</td><td>${p.yellow.min.toFixed(2)}</td><td>${p.yellow.target.toFixed(2)}</td><td>${p.yellow.max.toFixed(2)}</td></tr>
    <tr><td>Black</td><td>${p.black.min.toFixed(2)}</td><td>${p.black.target.toFixed(2)}</td><td>${p.black.max.toFixed(2)}</td></tr>
    <tr><td>TVA (50%)</td><td>64.00%</td><td>69.00%</td><td>74.00%</td></tr>
    <tr><td>Opacidade Branca</td><td>50.00%</td><td>52.00%</td><td>56.00%</td></tr>
  `;
  detailsDiv.style.display = 'block';
}
function populateColorDropdown(products) {
  const colorSelect = document.getElementById("colorSelect");
  colorSelect.innerHTML = `<option value="">Selecione uma cor (produto)...</option>`;
  products.forEach(prod => {
    const opt = document.createElement("option");
    opt.value = prod;
    opt.textContent = prod;
    colorSelect.appendChild(opt);
  });
}
function updateReportDisplay() {
  if (!lastInspections || lastInspections.length === 0) return;
  const excludeAcerto = document.getElementById("excludeAcertoCor").checked;
  const filteredData = excludeAcerto ? lastInspections.filter(item => (item.bobina || "").trim() !== "Acerto de Cor") : lastInspections;

  const resultsAreaDiv = document.getElementById("resultsArea");
  if (filteredData.length === 0) {
    resultsAreaDiv.innerHTML = `<div class="placeholder-message">Todas as inspeções deste período são "Acerto de Cor".</div>`;
    fillStats(0, 0, 0);
    populateColorDropdown([]);
    document.getElementById("histogramBtn").disabled = true;
    return;
  }

  const { grouped, total, approved, rejected } = groupAndStats(filteredData);
  fillStats(total, approved, rejected);
  renderProducts(grouped);
  generateShiftComparison(filteredData);
}
async function generateReport() {
  resetStats();
  const resultsAreaDiv = document.getElementById("resultsArea");
  resultsAreaDiv.innerHTML = `<div class="placeholder-message">Carregando…</div>`;
  const dates = getDates();
  if (!dates) return;
  const opVal = document.getElementById("reportOp").value.trim();
  const opFilter = opVal || null;

  try {
    // Busca dados das duas tabelas em paralelo
    const [colorData, processData] = await Promise.all([
      fetchReportData(dates.sd.toISOString(), dates.ed.toISOString(), opFilter),
      fetchProcessReportData(dates.sd.toISOString(), dates.ed.toISOString(), opFilter)
    ]);

    lastInspections = colorData; // Mantém compatibilidade com funções existentes
    window.lastProcessData = processData; // Armazena para uso no dashboard visual

    if (colorData.length === 0 && processData.length === 0) {
      resultsAreaDiv.innerHTML = `<div class="placeholder-message">Nenhuma inspeção encontrada no período.</div>`;
      return;
    }

    renderUnifiedDashboard(colorData, processData);
    updateReportDisplay(); // Atualiza estatísticas e gráficos de cor existentes
  } catch (err) {
    console.error(err);
    resultsAreaDiv.innerHTML = `<div class="error">Erro ao buscar dados: ${err.message}</div>`;
  }
}

async function fetchProcessReportData(sdISO, edISO, opFilter) {
  let allData = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;

  try {
    while (keepFetching) {
      let query = sb.from("inspecoes_processo")
        .select("*")
        .gte("created_at", sdISO)
        .lte("created_at", edISO);
      
      if (opFilter !== null) query = query.eq("op_number", opFilter);
      
      query = query.order("created_at", { ascending: true })
                   .range(offset, offset + batchSize - 1);
      
      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allData = allData.concat(data);
        if (data.length < batchSize) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }
    return allData;
  } catch (e) {
    console.error("Erro ao buscar dados do relatório de processo:", e);
    throw e;
  }
}

function renderUnifiedDashboard(colorData, processData) {
  const resultsAreaDiv = document.getElementById("resultsArea");
  // Opcional: Criar uma área específica para o dashboard antes da lista de produtos
  let dashboardHtml = `<h2>Painel de Qualidade por OP</h2><div class="table-container"><table>
    <thead><tr><th>OP</th><th>Produto</th><th>Status Cor (Lab)</th><th>Status Processo (CMYK)</th></tr></thead>
    <tbody>`;

  // Agrupa dados por OP e Produto
  const ops = {};
  colorData.forEach(c => {
    const key = `${c.op}_${c.product}`;
    if (!ops[key]) ops[key] = { op: c.op, product: c.product, lab: [], process: [] };
    ops[key].lab.push(c);
  });
  processData.forEach(p => {
    const key = `${p.op_number}_${p.produto}`;
    if (!ops[key]) ops[key] = { op: p.op_number, product: p.produto, lab: [], process: [] };
    ops[key].process.push(p);
  });

  const keys = Object.keys(ops).sort();
  if (keys.length === 0) {
    dashboardHtml += '<tr><td colspan="4" style="text-align:center;">Sem dados para o painel.</td></tr>';
  } else {
    keys.forEach(k => {
      const entry = ops[k];
      const labStatus = entry.lab.length > 0 ? (entry.lab.every(l => parseFloat(l.deltae) <= 2) ? 'Aprovado' : 'Reprovado') : '-';
      const procStatus = entry.process.length > 0 ? (entry.process.every(p => p.status_geral === 'APROVADO') ? 'Aprovado' : 'Reprovado') : '-';

      const labClass = labStatus === 'Aprovado' ? 'status-aprovado' : (labStatus === 'Reprovado' ? 'status-reprovado' : '');
      const procClass = procStatus === 'Aprovado' ? 'status-aprovado' : (procStatus === 'Reprovado' ? 'status-reprovado' : '');

      dashboardHtml += `<tr>
        <td>${entry.op || '-'}</td>
        <td>${entry.product || '-'}</td>
        <td class="${labClass}">${labStatus}</td>
        <td class="${procClass}">${procStatus}</td>
      </tr>`;
    });
  }

  dashboardHtml += `</tbody></table></div><br>`;
  resultsAreaDiv.innerHTML = dashboardHtml;
}
function getShift(timestamp) {
  if (!timestamp) return 'Indefinido';
  const date = new Date(timestamp);
  // Ajuste explícito para o fuso de Brasília para extrair hora/minuto
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const timeInMinutes = hour * 60 + minute;

  // Turno A: 07:40 as 16:00
  if (timeInMinutes >= 7 * 60 + 40 && timeInMinutes < 16 * 60) return 'Turno A';
  // Turno B: 16:01 as 23:59
  if (timeInMinutes >= 16 * 60 + 1 && timeInMinutes <= 23 * 60 + 59) return 'Turno B';
  // Turno C: 00:00 a 07:39
  return 'Turno C';
}

function calculateQuartiles(arr) {
  if (arr.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const getValue = (p) => {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  };
  return {
    min: sorted[0],
    q1: getValue(0.25),
    median: getValue(0.5),
    q3: getValue(0.75),
    max: sorted[sorted.length - 1]
  };
}

let isPlottingShiftChart = false; // Guard contra loop de renderização

function generateShiftComparison(dataToPlot) {
  if (isPlottingShiftChart) return;
  isPlottingShiftChart = true;

  try {
    const dataForChart = dataToPlot || lastInspections;
    if (!dataForChart || dataForChart.length === 0) {
      isPlottingShiftChart = false;
      return;
    }

    const stats = {
      'Turno A': [],
      'Turno B': [],
      'Turno C': []
    };

    dataForChart.forEach(item => {
      const shift = getShift(item.timestamp);
      const de = parseFloat(item.deltae);
      if (stats[shift] && !isNaN(de)) {
        stats[shift].push(de);
      }
    });

    const categories = ['Turno A', 'Turno B', 'Turno C'];
    const labels = ['Turno A (07h40-16h00)', 'Turno B (16h01-23h59)', 'Turno C (00h00-07h39)'];
    const colors = ['#f39c12', '#2c3e50', '#9b59b6'];

    // 1. Camada do Box Plot (Apenas Visual)
    const boxTraces = categories.map((cat, idx) => {
      return {
        y: stats[cat],
        type: 'box',
        name: labels[idx],
        marker: { color: colors[idx], size: 4 },
        boxpoints: 'suspectedoutliers',
        boxmean: true,
        line: { width: 1.5 },
        hoverinfo: 'skip', // IGNORAR TOTALMENTE O HOVER DA CAIXA
        showlegend: false
      };
    });


    // 2. Camada de Hover (Invisível, centralizada na média para capturar o mouse)
    const hoverTraces = categories.map((cat, idx) => {
      const vals = stats[cat];
      const n = vals.length;
      if (n === 0) return null;

      const s = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((a, b) => a + b, 0) / n;
      const mid = Math.floor(n / 2);
      const median = n % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;

      return {
        x: [labels[idx]],
        y: [mean],
        type: 'scatter',
        mode: 'markers',
        name: labels[idx],
        marker: { color: 'rgba(0,0,0,0)', size: 25 }, // Área de captura invisível
        hoverinfo: 'text',
        text: [`<b>${labels[idx]}</b><br>Média: ${mean.toFixed(2)}<br>Mediana: ${median.toFixed(2)}`],
        showlegend: false
      };
    }).filter(t => t !== null);

    const data = [...boxTraces, ...hoverTraces];

    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(255,255,255,0.05)',
      font: { color: '#5f6368', family: 'Inter, sans-serif', size: 12 },
      yaxis: {
        title: 'Delta E (ΔE₀₀)',
        zeroline: false,
        gridcolor: 'rgba(0,0,0,0.1)',
        tickfont: { weight: 'bold' },
        rangemode: 'tozero'
      },
      xaxis: {
        tickfont: { weight: 'bold' }
      },
      margin: { t: 40, b: 60, l: 60, r: 20 },
      showlegend: false,
      hovermode: 'closest',
      hoverlabel: {
        bgcolor: '#FFF',
        bordercolor: '#CCC',
        font: { family: 'Inter, sans-serif', size: 13, color: '#333' },
        align: 'left'
      }
    };

    const config = {
      responsive: true,
      displayModeBar: false,
      locale: 'pt-BR'
    };

    if (window.Plotly) {
      window.Plotly.newPlot('shiftChart', data, layout, config);
    } else {
      console.error("Plotly não carregado.");
    }

  } catch (err) {
    console.error("Erro ao plotar gráfico de turnos com Plotly:", err);
  } finally {
    isPlottingShiftChart = false;
  }
}

// Função renderProcessDeviationChart removida a pedido - Foco em tabelas de dados.

function generateHistogram() {
  if (histogramChartInstance) {
    histogramChartInstance.destroy();
    histogramChartInstance = null;
  }
  const selectedColor = document.getElementById("colorSelect").value;
  if (!selectedColor) { alert("Selecione uma cor para gerar o histograma."); return; }

  const excludeAcerto = document.getElementById("excludeAcertoCor").checked;
  const filteredData = excludeAcerto ? lastInspections.filter(item => (item.bobina || "").trim() !== "Acerto de Cor") : lastInspections;

  const deltaEValues = filteredData.filter(item => item.product === selectedColor).map(item => parseFloat(item.deltae)).filter(d => !isNaN(d));
  if (deltaEValues.length === 0) { alert("Não há dados de ΔE para o produto selecionado."); return; }
  const numBins = 10;
  const minDE = Math.min(...deltaEValues);
  const maxDE = Math.max(...deltaEValues);
  const binWidth = (maxDE - minDE) / numBins || 0.1;
  const binCounts = Array(numBins).fill(0);
  deltaEValues.forEach(d => {
    let binIndex = Math.floor((d - minDE) / binWidth);
    if (binIndex >= numBins) binIndex = numBins - 1;
    if (binIndex < 0) binIndex = 0;
    binCounts[binIndex]++;
  });
  const binLabels = Array.from({ length: numBins }, (_, i) => `${(minDE + i * binWidth).toFixed(2)}–${(minDE + (i + 1) * binWidth).toFixed(2)}`);
  const ctx = document.getElementById("histogramChart").getContext("2d");
  histogramChartInstance = new window.Chart(ctx, {
    type: "bar",
    data: { labels: binLabels, datasets: [{ label: `Frequência de ΔE para "${selectedColor}"`, data: binCounts, backgroundColor: "rgba(36, 99, 235, 0.7)" }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: "Intervalo de ΔE" } }, y: { title: { display: true, text: "Frequência" }, beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });
}
function downloadExcel() {
  if (!lastInspections.length) return;
  const rows = [["Produto", "Bobina", "OP", "L Orig.", "a Orig.", "b Orig.", "L Insp.", "a Insp.", "b Insp.", "ΔE", "Data/Hora", "Colorista", "Matrícula", "Justificativa"]];
  // MODIFICAÇÃO: Correção do fuso horário para Brasília no Excel
  lastInspections.forEach(item => rows.push([
    item.product || "-",
    item.bobina || "-",
    item.op ?? "-",
    item.original_l ?? "-",
    item.original_a ?? "-",
    item.original_b ?? "-",
    item.inspected_l ?? "-",
    item.inspected_a ?? "-",
    item.inspected_b ?? "-",
    item.deltae,
    item.timestamp ? new Date(item.timestamp).toLocaleString("pt-BR", { timeZone: 'America/Sao_Paulo' }) : "-",
    item.colorista || "-",
    item.matricula || "-",
    item.justification || "-"
  ]));
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Inspeções");
  const start = document.getElementById("reportStartDate").value.replace(/-/g, "");
  const end = document.getElementById("reportEndDate").value.replace(/-/g, "");
  window.XLSX.writeFile(wb, `inspecoes_${start}_${end}.xlsx`);
}
async function generateLaudo() {
  const opVal = document.getElementById("reportOp").value.trim();
  if (!opVal) { alert("Informe a OP para gerar o laudo."); return; }
  const dates = getDates();
  if (!dates) return;
  const laudoAreaDiv = document.getElementById("laudoArea");
  laudoAreaDiv.innerHTML = `<div class="placeholder-message"><i class="fas fa-spinner fa-spin"></i> Consolidando dados da OP ${opVal}...</div>`;

  try {
    // 1. Buscar todos os dados relevantes em paralelo
    // NOTA: No banco inspecões_processo, op_number é TEXTO. Em color_inspections, op costuma ser inteiro.
    const [colorData, processData] = await Promise.all([
      fetchReportData(dates.sd.toISOString(), dates.ed.toISOString(), opVal),
      fetchProcessReportData(dates.sd.toISOString(), dates.ed.toISOString(), opVal)
    ]);

    if (colorData.length === 0 && processData.length === 0) {
      laudoAreaDiv.innerHTML = `<div class="placeholder-message">Nenhuma inspeção (Cor ou Processo) encontrada para a OP ${opVal}.</div>`;
      return;
    }

    // 2. Identificar o código do produto (Garantir que pegamos apenas o CÓDIGO antes do hífen)
    let rawProduct = colorData.length > 0 ? colorData[0].product : (processData.length > 0 ? processData[0].produto : "Desconhecido");
    const productCode = rawProduct.split(' - ')[0].split('-')[0].trim();

    // 3. Buscar os Padrões de Processo no Banco
    const { data: standards, error: stdError } = await sb.from("process_standards").select("*").eq("product_code", productCode);

    let laudoHtml = `
      <div class="laudo-report">
        <div class="laudo-header">
          <div>
            <h2 style="margin:0; color:var(--primary-dark)">Laudo Estatístico de Produção</h2>
            <span style="color:var(--text-light)">OP: <strong>${opVal}</strong> | Produto: <strong>${productCode}</strong></span>
          </div>
          <div style="text-align:right">
            <span class="laudo-badge badge-success">SISTEMA COLORAPP</span><br>
            <small>${new Date().toLocaleDateString("pt-BR")}</small>
          </div>
        </div>
    `;

    // --- SEÇÃO 1: CONFORMIDADE DE COR (LAB) ---
    if (colorData.length > 0) {
      laudoHtml += `<div class="laudo-section">
        <h4><i class="fas fa-eye"></i> Controle de Cor (Delta E)</h4>
        <div class="laudo-grid">`;

      const grouped = {};
      colorData.forEach(item => {
        const prod = item.product || "Não especificado";
        if (!grouped[prod]) grouped[prod] = [];
        grouped[prod].push(item);
      });

      Object.keys(grouped).forEach(prod => {
        const arr = grouped[prod];
        const values = arr.map(i => parseFloat(i.deltae)).filter(v => !isNaN(v));
        const n = values.length;
        const avg = n > 0 ? values.reduce((s, v) => s + v, 0) / n : 0;
        const max = n > 0 ? Math.max(...values) : 0;
        const statusClass = avg <= 2.0 ? 'badge-success' : (avg <= 3.0 ? 'badge-warning' : 'badge-danger');

        laudoHtml += `
          <div class="laudo-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
              <strong style="font-size:1rem;">${prod}</strong>
              <span class="laudo-badge ${statusClass}">${avg <= 2.5 ? 'Conforme' : 'Ajuste Nec.'}</span>
            </div>
            <ul class="laudo-stats-list">
              <li><span>Total Amostras:</span> <strong>${n}</strong></li>
              <li><span>ΔE Médio:</span> <strong>${avg.toFixed(2)}</strong></li>
              <li><span>ΔE Máximo:</span> <strong>${max.toFixed(2)}</strong></li>
              <li><span>Superior a 2.5 ΔE:</span> <strong style="color:${arr.filter(v => v.deltae > 2.5).length > 0 ? 'var(--danger)' : 'inherit'}">${arr.filter(v => v.deltae > 2.5).length}</strong></li>
            </ul>
          </div>`;
      });
      laudoHtml += `</div></div>`;
    }

    // --- SEÇÃO 2: CONTROLE DE PROCESSO (CMYK / TVA / OPACIDADE) ---
    if (processData.length > 0) {
      laudoHtml += `<div class="laudo-section">
        <h4><i class="fas fa-microscope"></i> Controle de Processo (Densitometria e TVA)</h4>
        <div class="table-container" style="overflow-x:auto;">
          <table class="laudo-table">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Alvo Padrão</th>
                <th>Média OP</th>
                <th>Desvio</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>`;

      // Analisar cada variável de processo usando as colunas explícitas ( Cyan, Magenta, Yellow, Black )
      const processMetrics = [
        { label: 'Cyan', colDens: 'densidade_c_medido', colTva: 'tva_c_medido', std_name: 'cyan' },
        { label: 'Magenta', colDens: 'densidade_m_medido', colTva: 'tva_m_medido', std_name: 'magenta' },
        { label: 'Yellow', colDens: 'densidade_y_medido', colTva: 'tva_y_medido', std_name: 'yellow' },
        { label: 'Black', colDens: 'densidade_k_medido', colTva: 'tva_k_medido', std_name: 'black' }
      ];

      processMetrics.forEach(metric => {
        const densValues = processData.map(entry => parseFloat(entry[metric.colDens])).filter(v => !isNaN(v));
        const tvaValues = processData.map(entry => parseFloat(entry[metric.colTva])).filter(v => !isNaN(v));

        if (densValues.length === 0 && tvaValues.length === 0) return;

        const std = standards ? standards.find(s => s.color_name.toLowerCase() === metric.std_name) : null;

        // Linha de Densitometria
        if (densValues.length > 0) {
          const avg = densValues.reduce((a, b) => a + b, 0) / densValues.length;
          const target = std ? std.dens_target : "-";
          const desvio = std && target !== "-" ? (avg - target).toFixed(2) : "-";
          const isOk = std ? (avg >= std.dens_min && avg <= std.dens_max) : true;

          laudoHtml += `
            <tr>
              <td><strong>${metric.label}</strong> (Densidade)</td>
              <td>${target}</td>
              <td>${avg.toFixed(2)}</td>
              <td style="color:${(desvio !== "-" && (parseFloat(desvio) > 0.1 || parseFloat(desvio) < -0.1)) ? 'var(--active-red)' : 'inherit'}">${desvio}</td>
              <td><span class="laudo-badge ${isOk ? 'badge-success' : 'badge-danger'}">${isOk ? 'OK' : 'FORA'}</span></td>
            </tr>`;
        }

        // Linha de TVA
        if (tvaValues.length > 0) {
          const avg = tvaValues.reduce((a, b) => a + b, 0) / tvaValues.length;
          const target = std ? (std.tva_target || 69) : 69;
          const desvio = (avg - target).toFixed(1);
          const isOk = avg <= (std ? (std.tva_max || 74) : 74);

          laudoHtml += `
            <tr>
              <td><span style="color:var(--text-light)">${metric.label} (TVA 50%)</span></td>
              <td>${target}%</td>
              <td>${avg.toFixed(1)}%</td>
              <td>${desvio}%</td>
              <td><span class="laudo-badge ${isOk ? 'badge-success' : 'badge-warning'}">${isOk ? 'OK' : 'ALTO'}</span></td>
            </tr>`;
        }
      });

      laudoHtml += `</tbody></table></div>`;

      // --- SEÇÃO 3: OPACIDADE (Colunas Explícitas) ---
      const opacityValues = processData.map(entry => parseFloat(entry.opacidade_branco_medido)).filter(v => !isNaN(v));
      if (opacityValues.length > 0) {
        const avgOp = opacityValues.reduce((a, b) => a + b, 0) / opacityValues.length;
        const opTarget = "52.00%";
        const opIsOk = avgOp >= 50 && avgOp <= 56;

        laudoHtml += `
          <div style="margin-top:20px;">
            <h4><i class="fas fa-fill-drip"></i> Opacidade do Branco</h4>
            <table class="laudo-table">
              <thead><tr><th>Elemento</th><th>Alvo Padrão</th><th>Média OP</th><th>Status</th></tr></thead>
              <tbody>
                <tr>
                  <td>Opacidade do Branco</td>
                  <td>${opTarget}</td>
                  <td>${avgOp.toFixed(2)}%</td>
                  <td><span class="laudo-badge ${opIsOk ? 'badge-success' : 'badge-danger'}">${opIsOk ? 'OK' : 'FORA'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>`;
      }

      laudoHtml += `</div>`;
      const opacValues = processData.map(p => p.opacidade_branca).filter(v => v !== null && v !== undefined);
      if (opacValues.length > 0) {
        const avgOpac = opacValues.reduce((a, b) => a + b, 0) / opacValues.length;
        const stdOpac = standards ? standards[0].opac_target : 52;
        laudoHtml += `
          <div class="laudo-section">
            <h4><i class="fas fa-layer-group"></i> Opacidade do Branco</h4>
            <div class="compliance-summary">
              <div class="compliance-item">
                <span>Alvo: <strong>${stdOpac}%</strong></span>
              </div>
              <div class="compliance-item">
                <span>Média OP: <strong style="font-size:1.2rem; color:var(--primary)">${avgOpac.toFixed(1)}%</strong></span>
              </div>
              <div class="compliance-item">
                <span class="laudo-badge ${avgOpac >= (standards ? standards[0].opac_min : 50) ? 'badge-success' : 'badge-danger'}">
                  ${avgOpac >= (standards ? standards[0].opac_min : 50) ? 'CONFORME' : 'ABAIXO DO PADRÃO'}
                </span>
              </div>
            </div>
          </div>
        `;
      }
    }

    // --- SEÇÃO FINAL: JUSTIFICATIVAS ---
    const justifications = [...colorData, ...processData].filter(i => i.justification);
    if (justifications.length > 0) {
      laudoHtml += `
        <div class="laudo-section">
          <h4><i class="fas fa-comment-alt"></i> Observações e Justificativas de Produção</h4>
          <div class="table-container">
            <table class="laudo-table">
              <thead><tr><th>Data</th><th>Tipo</th><th>Justificativa</th></tr></thead>
              <tbody>
                ${justifications.map(j => `
                  <tr>
                    <td><small>${new Date(j.timestamp || j.created_at).toLocaleString("pt-BR")}</small></td>
                    <td>${j.deltae ? 'Cor' : 'Processo'}</td>
                    <td><em style="color:#444">"${j.justification}"</em></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    laudoHtml += `
        <div style="margin-top:40px; padding:20px; border-radius:8px; background:#f1f5f9; text-align:center; font-size:0.8rem; color:#64748b;">
          Este documento é uma síntese estatística das inspeções realizadas via ColorApp.<br>
          <strong>Veredito Final: Este lote foi produzido dentro das tolerâncias estabelecidas de cor e densitometria.</strong>
        </div>
      </div>
    `;

    laudoAreaDiv.innerHTML = laudoHtml;

  } catch (err) {
    console.error("Erro ao gerar laudo:", err);
    laudoAreaDiv.innerHTML = `<div class="error">Erro ao gerar laudo: ${err.message}</div>`;
  }
}

window.onload = async function () {
  loadOpState();
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = d => d.toISOString().split("T")[0];
  document.getElementById("reportStartDate").value = fmt(first);
  document.getElementById("reportEndDate").value = fmt(today);
  document.getElementById("opid").addEventListener('input', saveOpState);
  document.getElementById("fixarop").addEventListener('change', saveOpState);
  document.getElementById("matriculaId").addEventListener('input', saveOpState);
  document.getElementById("fixarmatricula").addEventListener('change', saveOpState);
  document.getElementById("pc_matricula").addEventListener('input', saveOpState);
  document.getElementById("pc_fixarmatricula").addEventListener('change', saveOpState);

  populateProfileSelector();
  populateFixedTables();
  // loadProfileStandards removido pois agora é automático por código de produto

  updateinputcolorsample();
  updateColorSample(document.getElementById("newcolorpreview"), 0, 0, 0);

  updateDiagnosticPreviews();
  runColorDiagnostic();

  // Consolidação do carregamento de dados
  console.log("Iniciando carregamento de dados...");
  await fetchProductDescriptions();
  await fetchColoristas();
  await loadproducts();
  await loadProcessStandardsDb();
  await loadInitialInspections();
  await loadpantones();
  console.log("Dados carregados com sucesso.");

  showTab("search");
};

function analyzeCurrentInspection() {
  if (!selectedcolor) {
    alert("Erro: Nenhuma cor de referência selecionada.");
    return;
  }

  const l2 = parseFloat(document.getElementById("labl").value);
  const a2 = parseFloat(document.getElementById("laba").value);
  const b2 = parseFloat(document.getElementById("labb").value);

  if (isNaN(l2) || isNaN(a2) || isNaN(b2)) {
    alert("Por favor, insira valores L, a, b válidos na inspeção antes de diagnosticar.");
    return;
  }
  analyzeInspectionInDiagnostic(selectedcolor.l, selectedcolor.a, selectedcolor.b, l2, a2, b2);
}

async function loadProcessStandardsDb() {
  const tbody = document.getElementById('processStandardsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Carregando...</td></tr>';

  let allStandards = [];
  let offset = 0;
  const batchSize = 1000;
  let keepFetching = true;

  try {
    while (keepFetching) {
      const { data, error } = await sb.from("process_standards")
                                     .select("product_code")
                                     .order('product_code')
                                     .range(offset, offset + batchSize - 1);
      if (error) throw error;
      
      if (data && data.length > 0) {
        allStandards = allStandards.concat(data);
        if (data.length < batchSize) {
          keepFetching = false;
        } else {
          offset += batchSize;
        }
      } else {
        keepFetching = false;
      }
    }

    const uniqueProducts = [...new Set(allStandards.map(i => i.product_code))];
    processStandardsdb = uniqueProducts.map(code => ({ product_code: code }));

    updateProcessStandardsTable();
  } catch (e) {
    console.error("Erro ao carregar padrões de processo:", e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--danger);">Erro ao carregar dados.</td></tr>';
  }
}

function updateProcessStandardsTable() {
  const tbody = document.getElementById('processStandardsBody');
  if (!tbody) return;
  tbody.innerHTML = "";

  if (processStandardsdb.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum padrão cadastrado.</td></tr>';
    return;
  }

  processStandardsdb.forEach(p => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${p.product_code}</td>
      <td colspan="5" style="text-align:center; font-style:italic; color:var(--text-light)">Padrão Multi-Cores e ANILOX</td>
      <td style="display: flex; gap: 8px; justify-content: center;">
        <button class="btn-primary btn-small" onclick="editProcessProduct('${p.product_code}')">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn-danger btn-small" onclick="removeProcessProduct('${p.product_code}')">
          <i class="fas fa-trash"></i> Remover
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function addSpecialColorRow() {
  const wrapper = document.getElementById('reg_process_cards_wrapper');
  const card = document.createElement('div');
  card.className = 'color-card-premium card-special';
  card.innerHTML = `
    <div class="color-card-header">
      <input type="text" class="special-name-input" placeholder="Nome da Cor Especial">
      <button class="btn-remove-card" onclick="this.closest('.color-card-premium').remove()" title="Remover Cor">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
    <div class="color-card-body">
      <div class="input-row-group">
        <span class="input-row-label"><i class="fas fa-tint"></i> Densitometria</span>
        <div class="inputs-triple">
          <input type="number" step="0.01" class="dens-min" placeholder="Mín">
          <input type="number" step="0.01" class="dens-target" placeholder="Alvo">
          <input type="number" step="0.01" class="dens-max" placeholder="Máx">
        </div>
      </div>
      <div class="input-row-group">
        <span class="input-row-label"><i class="fas fa-chart-line"></i> TVA %</span>
        <div class="inputs-triple">
          <input type="number" step="0.1" class="tva-min" placeholder="Mín" value="64">
          <input type="number" step="0.1" class="tva-target" placeholder="Alvo" value="69">
          <input type="number" step="0.1" class="tva-max" placeholder="Máx" value="74">
        </div>
      </div>
      <div class="input-row-group">
        <span class="input-row-label"><i class="fas fa-tools"></i> ANILOX</span>
        <div class="equip-inputs">
          <input type="text" class="anilox" placeholder="Número do anilox">
          <input type="text" class="anilox-num" placeholder="Nº Linhas / BCM">
          <input type="text" class="dupla-face" placeholder="Dupla Face">
        </div>
      </div>
    </div>
  `;
  // Add before opacity card
  const opacityCard = wrapper.querySelector('.opacity-card-premium');
  wrapper.insertBefore(card, opacityCard);
}

function resetProcessRegisterTable(keepHeader = false) {
  const wrapper = document.getElementById('reg_process_cards_wrapper');
  if (!wrapper) return;

  if (!keepHeader) {
    // Limpa também os campos de cabeçalho
    document.getElementById("reg_proc_product_code").value = "";
    const descDisplay = document.getElementById("cmyk_desc_display");
    if (descDisplay) descDisplay.textContent = "";
  }

  wrapper.innerHTML = `
    <table id="reg_process_table" style="display:none;"><tbody id="reg_process_tbody"></tbody></table>
    
    <div class="color-card-premium card-cyan" data-color="Cyan">
      <div class="color-card-header"><span><i class="fas fa-palette"></i> Cyan</span></div>
      <div class="color-card-body">
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tint"></i> Densitometria (Mín / Alvo / Máx)</span>
          <div class="inputs-triple">
            <input type="number" step="0.01" class="dens-min" placeholder="Mín">
            <input type="number" step="0.01" class="dens-target" placeholder="Alvo">
            <input type="number" step="0.01" class="dens-max" placeholder="Máx">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-chart-line"></i> TVA % (Mín / Alvo / Máx)</span>
          <div class="inputs-triple">
            <input type="number" step="0.1" class="tva-min" placeholder="Mín" value="64">
            <input type="number" step="0.1" class="tva-target" placeholder="Alvo" value="69">
            <input type="number" step="0.1" class="tva-max" placeholder="Máx" value="74">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tools"></i> ANILOX</span>
          <div class="equip-inputs">
            <input type="text" class="anilox" placeholder="Número do anilox">
            <input type="text" class="anilox-num" placeholder="Nº Linhas / BCM">
            <input type="text" class="dupla-face" placeholder="Dupla Face">
          </div>
        </div>
      </div>
    </div>

    <div class="color-card-premium card-magenta" data-color="Magenta">
      <div class="color-card-header"><span><i class="fas fa-palette"></i> Magenta</span></div>
      <div class="color-card-body">
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tint"></i> Densitometria</span>
          <div class="inputs-triple">
            <input type="number" step="0.01" class="dens-min" placeholder="Mín">
            <input type="number" step="0.01" class="dens-target" placeholder="Alvo">
            <input type="number" step="0.01" class="dens-max" placeholder="Máx">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-chart-line"></i> TVA %</span>
          <div class="inputs-triple">
            <input type="number" step="0.1" class="tva-min" placeholder="Mín" value="64">
            <input type="number" step="0.1" class="tva-target" placeholder="Alvo" value="69">
            <input type="number" step="0.1" class="tva-max" placeholder="Máx" value="74">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tools"></i> ANILOX</span>
          <div class="equip-inputs">
            <input type="text" class="anilox" placeholder="Número do anilox">
            <input type="text" class="anilox-num" placeholder="Nº Linhas / BCM">
            <input type="text" class="dupla-face" placeholder="Dupla Face">
          </div>
        </div>
      </div>
    </div>

    <div class="color-card-premium card-yellow" data-color="Yellow">
      <div class="color-card-header"><span><i class="fas fa-palette"></i> Yellow</span></div>
      <div class="color-card-body">
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tint"></i> Densitometria</span>
          <div class="inputs-triple">
            <input type="number" step="0.01" class="dens-min" placeholder="Mín">
            <input type="number" step="0.01" class="dens-target" placeholder="Alvo">
            <input type="number" step="0.01" class="dens-max" placeholder="Máx">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-chart-line"></i> TVA %</span>
          <div class="inputs-triple">
            <input type="number" step="0.1" class="tva-min" placeholder="Mín" value="64">
            <input type="number" step="0.1" class="tva-target" placeholder="Alvo" value="69">
            <input type="number" step="0.1" class="tva-max" placeholder="Máx" value="74">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tools"></i> ANILOX</span>
          <div class="equip-inputs">
            <input type="text" class="anilox" placeholder="Número do anilox">
            <input type="text" class="anilox-num" placeholder="Nº Linhas / BCM">
            <input type="text" class="dupla-face" placeholder="Dupla Face">
          </div>
        </div>
      </div>
    </div>

    <div class="color-card-premium card-black" data-color="Black">
      <div class="color-card-header"><span><i class="fas fa-palette"></i> Black</span></div>
      <div class="color-card-body">
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tint"></i> Densitometria</span>
          <div class="inputs-triple">
            <input type="number" step="0.01" class="dens-min" placeholder="Mín">
            <input type="number" step="0.01" class="dens-target" placeholder="Alvo">
            <input type="number" step="0.01" class="dens-max" placeholder="Máx">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-chart-line"></i> TVA %</span>
          <div class="inputs-triple">
            <input type="number" step="0.1" class="tva-min" placeholder="Mín" value="64">
            <input type="number" step="0.1" class="tva-target" placeholder="Alvo" value="69">
            <input type="number" step="0.1" class="tva-max" placeholder="Máx" value="74">
          </div>
        </div>
        <div class="input-row-group">
          <span class="input-row-label"><i class="fas fa-tools"></i> ANILOX</span>
          <div class="equip-inputs">
            <input type="text" class="anilox" placeholder="Número do anilox">
            <input type="text" class="anilox-num" placeholder="Nº Linhas / BCM">
            <input type="text" class="dupla-face" placeholder="Dupla Face">
          </div>
        </div>
      </div>
    </div>

    <div class="opacity-card-premium">
      <div class="opacity-title"><i class="fas fa-eye-slash"></i> Padrões de Opacidade do Branco</div>
      <div class="input-row-group">
        <span class="input-row-label">Opacidade (%) Mínimo / Alvo / Máximo</span>
        <div class="inputs-triple">
          <input type="number" step="0.1" id="reg_opac_min" placeholder="Mínimo">
          <input type="number" step="0.1" id="reg_opac_target" placeholder="Alvo" value="52">
          <input type="number" step="0.1" id="reg_opac_max" placeholder="Máximo">
        </div>
      </div>
    </div>
  `;
}

async function saveProcessStandards() {
  const product_code = document.getElementById("reg_proc_product_code").value.trim();
  const msgEl = document.getElementById("processRegisterMessage");

  if (!product_code) {
    alert("Código do produto é obrigatório!");
    return;
  }

  // Pegar valores de opacidade (Mín/Target/Máx)
  const getNum = (id) => {
    const el = document.getElementById(id);
    if (!el || el.value.trim() === "") return null;
    return parseFloat(el.value.replace(',', '.'));
  };

  const opac_min = getNum("reg_opac_min");
  const opac_target = getNum("reg_opac_target");
  const opac_max = getNum("reg_opac_max");

  const cards = document.querySelectorAll("#reg_process_cards_wrapper .color-card-premium");
  const dataToSave = [];

  cards.forEach(card => {
    let colorName;
    if (card.dataset.color) {
      colorName = card.dataset.color;
    } else {
      const nameInput = card.querySelector(".special-name-input");
      colorName = nameInput ? nameInput.value.trim() : null;
    }

    if (!colorName) return;

    const getVal = (selector) => {
      const el = card.querySelector(selector);
      if (!el || el.value.trim() === "") return null;
      return parseFloat(el.value.replace(',', '.'));
    };

    const getTxt = (selector) => {
      const el = card.querySelector(selector);
      return el ? el.value.trim() : null;
    };

    dataToSave.push({
      product_code,
      color_name: colorName,
      dens_min: getVal(".dens-min"),
      dens_target: getVal(".dens-target"),
      dens_max: getVal(".dens-max"),
      tva_min: getVal(".tva-min"),
      tva_target: getVal(".tva-target"),
      tva_max: getVal(".tva-max"),
      anilox: getTxt(".anilox"),
      anilox_num: getTxt(".anilox-num"),
      dupla_face: getTxt(".dupla-face"),
      opac_min: opac_min,
      opac_target: opac_target,
      opac_max: opac_max
    });
  });

  if (dataToSave.length === 0) {
    alert("Nenhuma cor para salvar!");
    return;
  }

  try {
    msgEl.textContent = "Salvando padrões...";
    msgEl.style.color = "var(--primary)";

    // 1. Limpar padrões existentes para este produto
    const { error: delError } = await sb.from("process_standards").delete().eq("product_code", product_code);
    if (delError) {
       throw new Error("Erro ao limpar dados antigos: " + delError.message);
    }

    // 2. Inserir novos padrões
    const { error: insError } = await sb.from("process_standards").insert(dataToSave);
    if (insError) {
       throw new Error("Erro ao inserir novos dados: " + insError.message);
    }

    msgEl.textContent = "Padrões salvos com sucesso!";
    msgEl.style.color = "var(--success)";
    
    // 3. Atualizar cache local e interface
    await loadProcessStandardsDb();
  } catch (e) {
    console.error("Erro completo ao salvar padrões:", e);
    msgEl.textContent = e.message;
    msgEl.style.color = "var(--danger)";
  }
}

async function removeProcessProduct(productCode) {
  if (!confirm(`Remover TODOS os padrões do produto ${productCode}?`)) return;
  try {
    const { error } = await sb.from("process_standards").delete().eq("product_code", productCode);
    if (error) throw error;
    loadProcessStandardsDb();
  } catch (e) {
    alert("Erro ao remover: " + e.message);
  }
}

async function editProcessProduct(productCode) {
  try {
    const { data, error } = await sb.from("process_standards").select("*").eq("product_code", productCode);
    if (error) throw error;
    if (!data || data.length === 0) {
      alert("Nenhum dado encontrado para este produto.");
      return;
    }

    // 2. Resetar o formulário mantendo o cabeçalho
    resetProcessRegisterTable(true);
    document.getElementById("reg_proc_product_code").value = productCode;

    // NOVO: Preencher exibição de descrição (apenas texto)
    const descDisplay = document.getElementById("cmyk_desc_display");
    if (descDisplay) {
      descDisplay.textContent = productDescriptions[productCode] || "";
    }

    const wrapper = document.getElementById('reg_process_cards_wrapper');

    // 2. Separar cores padrão de especiais
    const standardColors = ['Cyan', 'Magenta', 'Yellow', 'Black'];

    // 3. Preencher Opacidade (pegar de qualquer linha, pois é comum ao produto)
    const firstRow = data[0];
    document.getElementById("reg_opac_min").value = firstRow.opac_min !== null ? firstRow.opac_min : "";
    document.getElementById("reg_opac_target").value = firstRow.opac_target !== null ? firstRow.opac_target : "52";
    document.getElementById("reg_opac_max").value = firstRow.opac_max !== null ? firstRow.opac_max : "";

    // 4. Preencher Cartões
    data.forEach(row => {
      let card;
      if (standardColors.includes(row.color_name)) {
        // Encontrar o cartão padrão já existente
        card = wrapper.querySelector(`.color-card-premium[data-color="${row.color_name}"]`);
      } else {
        // Criar um novo cartão especial
        addSpecialColorRow();
        // O novo cartão é inserido antes da opacidade, então pegamos o último .card-special
        const specialCards = wrapper.querySelectorAll('.card-special');
        card = specialCards[specialCards.length - 1];
        const nameInput = card.querySelector(".special-name-input");
        if (nameInput) nameInput.value = row.color_name;
      }

      if (card) {
        if (row.dens_min !== null) card.querySelector(".dens-min").value = row.dens_min;
        if (row.dens_target !== null) card.querySelector(".dens-target").value = row.dens_target;
        if (row.dens_max !== null) card.querySelector(".dens-max").value = row.dens_max;

        if (row.tva_min !== null) card.querySelector(".tva-min").value = row.tva_min;
        if (row.tva_target !== null) card.querySelector(".tva-target").value = row.tva_target;
        if (row.tva_max !== null) card.querySelector(".tva-max").value = row.tva_max;

        if (row.anilox) card.querySelector(".anilox").value = row.anilox;
        if (row.anilox_num) card.querySelector(".anilox-num").value = row.anilox_num;
        if (row.dupla_face) card.querySelector(".dupla-face").value = row.dupla_face;
      }
    });

    // 5. Scroll suave para o formulário
    document.getElementById('process-register-tab').scrollIntoView({ behavior: 'smooth' });

    const msgEl = document.getElementById("processRegisterMessage");
    msgEl.textContent = `Editando padrões para: ${productCode}`;
    msgEl.style.color = "var(--primary)";

  } catch (e) {
    console.error("Erro ao carregar dados para edição:", e);
    alert("Erro ao carregar dados: " + e.message);
  }
}

