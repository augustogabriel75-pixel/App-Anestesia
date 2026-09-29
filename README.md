# VetAnest Monitor — Ficha Anestésica Veterinária

Aplicativo web responsivo (SPA/PWA) para **monitoramento anestésico veterinário em tempo real** e **exportação da ficha anestésica em PDF**. Pensado para uso rápido em celular ou tablet no centro cirúrgico: botões grandes, controles −/+ com repetição ao segurar e valores pré-preenchidos a partir do último registro.

## Como usar

- **Online:** publique a pasta em qualquer hospedagem estática (GitHub Pages, Netlify, Vercel…) e abra o `index.html`. No celular, use "Adicionar à tela inicial" para instalar como app.
- **Local:** `npx http-server .` e acesse `http://localhost:8080`. Abrir o arquivo direto (`file://`) também funciona, mas sem o modo offline.

Após o primeiro acesso online, o service worker guarda o app e as bibliotecas em cache, e ele passa a funcionar **offline**.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Perfil** (ícone 👤) | Nome do anestesista, CRMV/UF, clínica padrão, contato, **logotipo** (upload) e **assinatura** (upload ou desenhada na tela). Salvo uma única vez e usado em todas as fichas. |
| **Fichas** | Lista, busca, abertura e exclusão de fichas; backup e restauração em JSON. |
| **Paciente** | Clínica (editável por paciente), tutor (nome, telefone/WhatsApp com máscara, CPF opcional), paciente (espécie, raça, idade, sexo, castração, peso), procedimento, data, cirurgião, ASA I–V (+E), risco anestésico, jejum sólido/líquido, avaliação pré-anestésica. |
| **Fármacos** | MPA, indução, manutenção, analgesia/bloqueios e resgates: fármaco, dose (mg/kg, mcg/kg, mcg/kg/min, mg/kg/h…), via e horário. **Cálculo automático** da dose total e do volume (mL) a partir do peso e da concentração (concentrações usuais são sugeridas). Fluidoterapia (tipo e taxa em mL/kg/h e mL/h). |
| **Monitor** | Cronômetro da anestesia, intervalo de registro de 5/10/15 min com **alarme sonoro e vibratório**, tela sempre acesa (Wake Lock). Registro de FC, FR, PAS/PAD/PAM (PAM calculada automaticamente), SpO₂, EtCO₂, temperatura, glicemia, plano de Guedel, reflexos palpebral e corneano, globo ocular, agente e % do vaporizador, FiO₂, modo ventilatório, VC, PEEP, pressão de pico e observações. Eventos com um toque (intubação, incisão, bolus, hipotensão, extubação…). Últimos valores, gráfico de tendência e tabela editável. Valores fora da faixa aproximada da espécie aparecem em vermelho. |
| **Resumo/PDF** | Horários (início/fim da anestesia e da cirurgia, extubação), volume total de fluido (com estimativa por taxa × duração), intercorrências trans e pós-operatórias imediatas, qualidade da recuperação e **exportação do PDF** (download, visualização ou compartilhamento pelo celular). |

### Ficha em PDF (A4 paisagem)

1. Cabeçalho com logotipo, nome da clínica, anestesista, CRMV/UF e data.
2. Bloco com dados do paciente, do tutor e do procedimento.
3. Protocolo anestésico (fases, doses, vias, horários, dose total, volume) e fluidoterapia.
4. Tabela temporal com todos os parâmetros (hora, T+min, sinais vitais, plano, reflexos, vaporizador, ventilação, observações e eventos).
5. Gráfico de tendência (opcional).
6. Resumo final, assinatura digital e espaço para carimbo. Rodapé com paginação.

Anestesias curtas cabem em uma página; as mais longas ocupam duas ou mais páginas automaticamente.

## Tecnologia

- `index.html`: app completo (HTML + JavaScript puro, sem build).
- [Tailwind CSS](https://tailwindcss.com) (Play CDN) para o visual.
- [jsPDF](https://github.com/parallax/jsPDF) e [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) para o PDF.
- `localStorage` para perfil e fichas. Os dados **não saem do dispositivo**.
- `manifest.webmanifest` e `sw.js` para a instalação como PWA e o uso offline.

## Avisos

- Os dados ficam só no navegador do aparelho. Limpar os dados do site apaga as fichas, então faça **backups** periódicos (Fichas → Backup).
- Os cálculos de dose, as concentrações sugeridas e as faixas de referência são auxílios. **Sempre confira** antes de administrar qualquer fármaco. A responsabilidade clínica é do médico veterinário.
