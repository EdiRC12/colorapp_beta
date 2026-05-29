// profiles.js - Perfis Históricos de Referência CMYK
// Dados de perfis históricos de referência CMYK (dados locais)

const allProfileData = {
  "2141_Plastimarau_C3_FlexoPower_Maq205_NExT_WSI_BOPP_PET_INT": {
    "densities": {
      "cyan":    { "min": 1.276, "target": 1.376, "max": 1.476 },
      "magenta": { "min": 1.422, "target": 1.522, "max": 1.622 },
      "yellow":  { "min": 0.928, "target": 1.028, "max": 1.128 },
      "black":   { "min": 1.426, "target": 1.526, "max": 1.626 }
    }
  },
  "2142_Plastimarau_C3_FlexoPower_Maq205_NExT_WSI_PE_INT": {
    "densities": {
      "cyan":    { "min": 1.242, "target": 1.342, "max": 1.442 },
      "magenta": { "min": 1.292, "target": 1.392, "max": 1.492 },
      "yellow":  { "min": 0.908, "target": 1.008, "max": 1.108 },
      "black":   { "min": 1.358, "target": 1.458, "max": 1.558 }
    }
  },
  "2143_Plastimarau_C3_FlexoPower_Maq205_NExT_WSI_PE_EXT": {
    "densities": {
      "cyan":    { "min": 0.97,  "target": 1.07,  "max": 1.17  },
      "magenta": { "min": 1.122, "target": 1.222, "max": 1.322 },
      "yellow":  { "min": 0.642, "target": 0.742, "max": 0.842 },
      "black":   { "min": 1.064, "target": 1.164, "max": 1.264 }
    }
  },
  "2144_Plastimarau_C3_FlexoPower_Maq205_NExT_WSI_PE PIG_EXT": {
    "densities": {
      "cyan":    { "min": 1.128, "target": 1.228, "max": 1.328 },
      "magenta": { "min": 1.392, "target": 1.492, "max": 1.592 },
      "yellow":  { "min": 0.91,  "target": 1.01,  "max": 1.11  },
      "black":   { "min": 1.29,  "target": 1.39,  "max": 1.49  }
    }
  },
  "2149_Plastimarau_C3_FlexoPower_Maq205_KodakNX_BOPP_PET_INT": {
    "densities": {
      "cyan":    { "min": 1.296, "target": 1.396, "max": 1.496 },
      "magenta": { "min": 1.358, "target": 1.458, "max": 1.558 },
      "yellow":  { "min": 0.946, "target": 1.046, "max": 1.146 },
      "black":   { "min": 1.33,  "target": 1.43,  "max": 1.53  }
    }
  }
};

/**
 * Popula o <select> de seleção de perfis históricos
 */
function populateProfileSelector() {
  const select = document.getElementById('hist_profile_select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Selecione um perfil --</option>';

  Object.keys(allProfileData).forEach(function(profileName) {
    const option = document.createElement('option');
    option.value = profileName;
    // Exibe nome mais amigável (remove underscores)
    option.textContent = profileName.replace(/_/g, ' ');
    select.appendChild(option);
  });
}

/**
 * Exibe os dados do perfil selecionado na tabela
 * @param {string} profileName - Nome do perfil selecionado
 */
function showHistoricalProfile(profileName) {
  const detailsDiv = document.getElementById('historical-profile-details');
  const tbody = document.getElementById('hist_profile_tbody');

  if (!detailsDiv || !tbody) return;

  if (!profileName || !allProfileData[profileName]) {
    detailsDiv.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  const profile = allProfileData[profileName];
  tbody.innerHTML = '';

  // Renderizar densidades
  if (profile.densities) {
    const cores = { cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', black: 'Black' };
    Object.entries(profile.densities).forEach(function([key, vals]) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>Densidade ' + (cores[key] || key) + '</td>' +
        '<td>' + (vals.min  !== undefined ? vals.min  : '-') + '</td>' +
        '<td><strong>' + (vals.target !== undefined ? vals.target : '-') + '</strong></td>' +
        '<td>' + (vals.max  !== undefined ? vals.max  : '-') + '</td>';
      tbody.appendChild(tr);
    });
  }

  // Renderizar TVA, se existir
  if (profile.tva) {
    const cores = { cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', black: 'Black' };
    Object.entries(profile.tva).forEach(function([key, vals]) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>TVA % ' + (cores[key] || key) + '</td>' +
        '<td>' + (vals.min  !== undefined ? vals.min  : '-') + '</td>' +
        '<td><strong>' + (vals.target !== undefined ? vals.target : '-') + '</strong></td>' +
        '<td>' + (vals.max  !== undefined ? vals.max  : '-') + '</td>';
      tbody.appendChild(tr);
    });
  }

  // Renderizar opacidade, se existir
  if (profile.opacity) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>Opacidade Branco (%)</td>' +
      '<td>' + (profile.opacity.min    !== undefined ? profile.opacity.min    : '-') + '</td>' +
      '<td><strong>' + (profile.opacity.target !== undefined ? profile.opacity.target : '-') + '</strong></td>' +
      '<td>' + (profile.opacity.max    !== undefined ? profile.opacity.max    : '-') + '</td>';
    tbody.appendChild(tr);
  }

  detailsDiv.style.display = 'block';
}
