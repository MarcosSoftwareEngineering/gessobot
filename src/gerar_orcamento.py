import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image as RLImage
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import Flowable
from reportlab.lib.colors import HexColor
from PIL import Image as PILImage, ImageDraw
import io
import sys
import json
import re

# ── Fix encoding UTF-8 no Windows ───────────────────────────
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# ── Constantes de precificacao ───────────────────────────────
PRECO_POR_M2   = 460.0   # R$ por metro quadrado
FRETE_FIXO     = 150.0   # R$ fixo de deslocamento

# ── Paleta de cores ──────────────────────────────────────────
AZUL_ESCURO  = HexColor("#0D2B6E")
AZUL_MEDIO   = HexColor("#1A4DB5")
AZUL_CLARO   = HexColor("#4A90D9")
CINZA_ESCURO = HexColor("#2C2C2C")
CINZA_MEDIO  = HexColor("#555555")
CINZA_CLARO  = HexColor("#F2F4F8")
BRANCO       = HexColor("#FFFFFF")
DOURADO      = HexColor("#C8A94A")
VERDE_ESCURO = HexColor("#1A7A4A")

# ── Helpers ──────────────────────────────────────────────────
def limpar_telefone(telefone: str) -> str:
    """Remove sufixo @lid/@s.whatsapp.net e deixa so os digitos com formatacao."""
    if not telefone:
        return "--"
    # Remove qualquer coisa depois de @
    numero = telefone.split("@")[0]
    # Mantem apenas digitos
    digitos = re.sub(r'\D', '', numero)
    # Formata: +55 (XX) XXXXX-XXXX
    if len(digitos) == 13 and digitos.startswith("55"):
        return f"+{digitos[0:2]} ({digitos[2:4]}) {digitos[4:9]}-{digitos[9:]}"
    elif len(digitos) == 12 and digitos.startswith("55"):
        return f"+{digitos[0:2]} ({digitos[2:4]}) {digitos[4:8]}-{digitos[8:]}"
    elif len(digitos) == 11:
        return f"({digitos[0:2]}) {digitos[2:7]}-{digitos[7:]}"
    elif len(digitos) == 10:
        return f"({digitos[0:2]}) {digitos[2:6]}-{digitos[6:]}"
    return digitos

def calcular_valores(metragem_raw) -> tuple:
    """Retorna (metragem_float, subtotal_servico, frete, total)."""
    try:
        # Aceita "20", "20 m2", "4x5", "4 x 5" etc.
        raw = str(metragem_raw).strip().lower().replace("m2","").replace("m","").strip()
        if "x" in raw:
            partes = raw.split("x")
            metragem = float(partes[0].strip()) * float(partes[1].strip())
        else:
            metragem = float(raw)
    except Exception:
        metragem = 0.0
    subtotal = metragem * PRECO_POR_M2
    total    = subtotal + FRETE_FIXO
    return metragem, subtotal, FRETE_FIXO, total

# ── Estilos de texto ─────────────────────────────────────────
def estilos():
    return {
        "empresa": ParagraphStyle("empresa",
            fontName="Helvetica-Bold", fontSize=22,
            textColor=BRANCO, alignment=TA_LEFT, leading=26),
        "slogan": ParagraphStyle("slogan",
            fontName="Helvetica", fontSize=10,
            textColor=HexColor("#A8C4E8"), alignment=TA_LEFT, leading=14),
        "titulo_secao": ParagraphStyle("titulo_secao",
            fontName="Helvetica-Bold", fontSize=11,
            textColor=AZUL_ESCURO, alignment=TA_LEFT, leading=16,
            spaceBefore=14, spaceAfter=6),
        "label": ParagraphStyle("label",
            fontName="Helvetica-Bold", fontSize=9,
            textColor=CINZA_MEDIO, alignment=TA_LEFT, leading=13),
        "valor": ParagraphStyle("valor",
            fontName="Helvetica", fontSize=10,
            textColor=CINZA_ESCURO, alignment=TA_LEFT, leading=14),
        "rodape": ParagraphStyle("rodape",
            fontName="Helvetica", fontSize=8,
            textColor=HexColor("#999999"), alignment=TA_CENTER, leading=12),
        "total_label": ParagraphStyle("total_label",
            fontName="Helvetica-Bold", fontSize=12,
            textColor=BRANCO, alignment=TA_LEFT, leading=18),
        "total_valor": ParagraphStyle("total_valor",
            fontName="Helvetica-Bold", fontSize=16,
            textColor=DOURADO, alignment=TA_RIGHT, leading=20),
        "total_destaque": ParagraphStyle("total_destaque",
            fontName="Helvetica-Bold", fontSize=20,
            textColor=DOURADO, alignment=TA_RIGHT, leading=24),
        "obs": ParagraphStyle("obs",
            fontName="Helvetica-Oblique", fontSize=8,
            textColor=CINZA_MEDIO, alignment=TA_LEFT, leading=12),
    }

class LinhaColorida(Flowable):
    def __init__(self, cor, espessura=2, largura=None):
        super().__init__()
        self.cor = cor
        self.espessura = espessura
        self._largura = largura

    def draw(self):
        w = self._largura or self.canv._pagesize[0] - 4*cm
        self.canv.setStrokeColor(self.cor)
        self.canv.setLineWidth(self.espessura)
        self.canv.line(0, self.espessura/2, w, self.espessura/2)

# ── Logo circular preenchida ─────────────────────────────────
def cortar_circular(img_path, tamanho=400):
    """
    Gera logo circular salva como JPEG (sem canal alpha/transparencia).
    A imagem ocupa 100% do circulo — sem margens, sem fundo visivel.
    O ReportLab clippa o JPEG dentro do tamanho especificado em cm.
    """
    try:
        img = PILImage.open(img_path).convert("RGB")
    except Exception:
        # Fallback: circulo azul solido
        img = PILImage.new("RGB", (tamanho, tamanho), (13, 43, 110))

    # Crop central quadrado (garante proporcao 1:1)
    min_dim = min(img.size)
    left = (img.width  - min_dim) // 2
    top  = (img.height - min_dim) // 2
    img  = img.crop((left, top, left + min_dim, top + min_dim))

    # Redimensiona para tamanho alvo
    img = img.resize((tamanho, tamanho), PILImage.Resampling.LANCZOS)

    # Aplica mascara circular — fundo branco nos cantos (mesmo tom do cabecalho)
    fundo = PILImage.new("RGB", (tamanho, tamanho), (13, 43, 110))  # azul escuro
    mask  = PILImage.new("L",   (tamanho, tamanho), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, tamanho, tamanho), fill=255)
    fundo.paste(img, (0, 0), mask)   # cola imagem circular sobre fundo azul

    buf = io.BytesIO()
    fundo.save(buf, format="JPEG", quality=95)
    buf.seek(0)
    return buf

def preparar_imagem_portfolio(img_path, largura, altura):
    try:
        img = PILImage.open(img_path).convert("RGB")
        img_ratio   = img.width / img.height
        target_ratio = largura / altura
        if img_ratio > target_ratio:
            new_w = int(target_ratio * img.height)
            left  = (img.width - new_w) // 2
            img   = img.crop((left, 0, left + new_w, img.height))
        else:
            new_h = int(img.width / target_ratio)
            top   = (img.height - new_h) // 2
            img   = img.crop((0, top, img.width, top + new_h))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        buf.seek(0)
        return RLImage(buf, width=largura, height=altura)
    except Exception:
        return Paragraph("Imagem indisponivel", estilos()["obs"])

# ── Motor do PDF ─────────────────────────────────────────────
def gerar_pdf(dados: dict, output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.5*cm,  bottomMargin=2*cm
    )
    st    = estilos()
    story = []
    W     = A4[0] - 3.6*cm

    # ── Calculos financeiros ─────────────────────────────────
    metragem, subtotal, frete, total = calcular_valores(dados.get("metragem", 0))

    # ════════════════════════════════════════
    # CABECALHO
    # ════════════════════════════════════════
    logo_buf = cortar_circular("src/assets/Tavares_Gesso.jpeg", 300)
    logo_img = RLImage(logo_buf, width=3.2*cm, height=3.2*cm)

    header_data = [[
        logo_img,
        [
            Paragraph("Tavares Gesso", st["empresa"]),
            Paragraph("Montador de Drywall - Forro - Sancas - Gesso 3D", st["slogan"]),
            Spacer(1, 4),
            Paragraph("Qualidade e Elegancia em Cada Projeto", st["slogan"]),
        ],
        [
            Paragraph("<b>ORCAMENTO</b>", ParagraphStyle("orcnum",
                fontName="Helvetica-Bold", fontSize=9,
                textColor=DOURADO, alignment=TA_RIGHT)),
            Paragraph("N " + datetime.now().strftime('%Y%m%d%H%M'), ParagraphStyle("orcnum2",
                fontName="Helvetica-Bold", fontSize=12,
                textColor=BRANCO, alignment=TA_RIGHT)),
            Spacer(1, 8),
            Paragraph(datetime.now().strftime("%d/%m/%Y"), ParagraphStyle("data",
                fontName="Helvetica", fontSize=9,
                textColor=HexColor("#A8C4E8"), alignment=TA_RIGHT)),
        ]
    ]]
    header_table = Table(header_data, colWidths=[3.8*cm, W - 3.8*cm - 4*cm, 4*cm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), AZUL_ESCURO),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",   (0,0), (-1,-1), 10),
        ("RIGHTPADDING",  (0,0), (-1,-1), 10),
        ("TOPPADDING",    (0,0), (-1,-1), 14),
        ("BOTTOMPADDING", (0,0), (-1,-1), 14),
        ("ROUNDEDCORNERS", [8,8,8,8]),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 14))

    # ════════════════════════════════════════
    # DADOS DO CLIENTE  (com Endereco)
    # ════════════════════════════════════════
    story.append(Paragraph("DADOS DO CLIENTE", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    telefone_formatado = limpar_telefone(dados.get("telefone", ""))

    cliente_data = [
        [
            Paragraph("Nome",     st["label"]),
            Paragraph(dados.get("nome", "--"), st["valor"]),
            Paragraph("Telefone", st["label"]),
            Paragraph(telefone_formatado, st["valor"]),
        ],
        [
            Paragraph("Endereco", st["label"]),
            Paragraph(dados.get("endereco", "Nao informado"), st["valor"]),
            Paragraph("Ambiente", st["label"]),
            Paragraph(dados.get("ambiente", "--"), st["valor"]),
        ],
        [
            Paragraph("Cidade / Bairro", st["label"]),
            Paragraph(dados.get("localizacao", "Nao informada"), st["valor"]),
            Paragraph("", st["label"]),
            Paragraph("", st["valor"]),
        ],
    ]
    ct = Table(cliente_data, colWidths=[2.8*cm, W/2-2.8*cm, 2.8*cm, W/2-2.8*cm])
    ct.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO, CINZA_CLARO]),
        ("VALIGN",        (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING",   (0,0), (-1,-1), 10),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
        ("TOPPADDING",    (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("GRID",          (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(ct)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # DETALHES DO SERVICO
    # ════════════════════════════════════════
    story.append(Paragraph("DETALHES DO SERVICO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    metragem_display = f"{metragem:.1f} m2" if metragem > 0 else str(dados.get("metragem","--")) + " m2"

    servico_data = [
        [
            Paragraph("Servico",   st["label"]),
            Paragraph(dados.get("servico", "--"), st["valor"]),
            Paragraph("Metragem",  st["label"]),
            Paragraph(metragem_display, st["valor"]),
        ],
        [
            Paragraph("Acabamento",     st["label"]),
            Paragraph(dados.get("acabamento", "Padrao"), st["valor"]),
            Paragraph("Prazo Estimado", st["label"]),
            Paragraph(dados.get("prazo", "--"), st["valor"]),
        ],
    ]
    st2 = Table(servico_data, colWidths=[2.8*cm, W/2-2.8*cm, 2.8*cm, W/2-2.8*cm])
    st2.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("VALIGN",        (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING",   (0,0), (-1,-1), 10),
        ("RIGHTPADDING",  (0,0), (-1,-1), 8),
        ("TOPPADDING",    (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("GRID",          (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(st2)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # RESUMO FINANCEIRO
    # ════════════════════════════════════════
    story.append(Paragraph("RESUMO FINANCEIRO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    financeiro_data = [
        [
            Paragraph("Servico (" + metragem_display + " x R$ " + f"{PRECO_POR_M2:.0f}/m2)", st["label"]),
            Paragraph(f"R$ {subtotal:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."), st["valor"]),
        ],
        [
            Paragraph("Frete / Deslocamento (fixo)", st["label"]),
            Paragraph(f"R$ {frete:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."), st["valor"]),
        ],
    ]
    ft = Table(financeiro_data, colWidths=[W - 4*cm, 4*cm])
    ft.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",   (0,0), (-1,-1), 12),
        ("RIGHTPADDING",  (0,0), (-1,-1), 12),
        ("TOPPADDING",    (0,0), (-1,-1), 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 9),
        ("GRID",          (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
        ("ALIGN",         (1,0), (1,-1), "RIGHT"),
    ]))
    story.append(ft)

    # Barra de total
    total_fmt = f"R$ {total:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    total_data = [[
        Paragraph("TOTAL", st["total_label"]),
        Paragraph("<b>" + total_fmt + "</b>", st["total_destaque"]),
    ]]
    tt = Table(total_data, colWidths=[W - 4*cm, 4*cm])
    tt.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), AZUL_ESCURO),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",   (0,0), (-1,-1), 12),
        ("RIGHTPADDING",  (0,0), (-1,-1), 12),
        ("TOPPADDING",    (0,0), (-1,-1), 12),
        ("BOTTOMPADDING", (0,0), (-1,-1), 12),
        ("ALIGN",         (1,0), (1,0), "RIGHT"),
        ("ROUNDEDCORNERS", [0,0,4,4]),
    ]))
    story.append(tt)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # PORTFOLIO (Grade 2x2)
    # ════════════════════════════════════════
    story.append(Paragraph("NOSSO PORTFOLIO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    largura_img = (W / 2) - 0.2*cm
    altura_img  = 4.5*cm

    img_grid = [
        [
            preparar_imagem_portfolio("src/assets/El.03.jpeg", largura_img, altura_img),
            preparar_imagem_portfolio("src/assets/El.04.jpeg", largura_img, altura_img),
        ],
        [
            preparar_imagem_portfolio("src/assets/E.l09.jpeg", largura_img, altura_img),
            preparar_imagem_portfolio("src/assets/El.07.jpeg", largura_img, altura_img),
        ],
    ]
    tabela_portfolio = Table(img_grid, colWidths=[W/2, W/2])
    tabela_portfolio.setStyle(TableStyle([
        ("ALIGN",         (0,0), (-1,-1), "CENTER"),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("TOPPADDING",    (0,0), (-1,-1), 3),
        ("LEFTPADDING",   (0,0), (-1,-1), 3),
        ("RIGHTPADDING",  (0,0), (-1,-1), 3),
    ]))
    story.append(tabela_portfolio)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Acabamentos premium com design exclusivo - Forro liso - Drywall - Sancas - Gesso 3D",
        ParagraphStyle("port_leg", fontName="Helvetica-Oblique", fontSize=8,
            textColor=CINZA_MEDIO, alignment=TA_CENTER)
    ))
    story.append(Spacer(1, 12))

    # ════════════════════════════════════════
    # GARANTIAS
    # ════════════════════════════════════════
    garantias = [
        ["Visita tecnica inclusa",       "Garantia de 1 ano"],
        ["Medicao e projeto gratuitos",   "Materiais de alta qualidade"],
        ["Equipe especializada",          "Suporte pos-obra"],
    ]
    g_table = Table(garantias, colWidths=[W/2, W/2])
    g_table.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO, CINZA_CLARO]),
        ("FONTNAME",      (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE",      (0,0), (-1,-1), 9),
        ("TEXTCOLOR",     (0,0), (-1,-1), CINZA_ESCURO),
        ("LEFTPADDING",   (0,0), (-1,-1), 12),
        ("TOPPADDING",    (0,0), (-1,-1), 7),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("GRID",          (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(g_table)
    story.append(Spacer(1, 12))

    # ════════════════════════════════════════
    # OBSERVACOES
    # ════════════════════════════════════════
    obs_box = Table([[
        Paragraph(
            "<b>Observacoes:</b> Orcamento valido por 15 dias. "
            "Valores sujeitos a alteracao apos vistoria tecnica in loco. "
            "Nao inclui pintura, eletrica ou outras especialidades. "
            "Frete de R$ 150,00 ja incluso no total.",
            st["obs"])
    ]], colWidths=[W])
    obs_box.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), HexColor("#FFF8E7")),
        ("LEFTPADDING",   (0,0), (-1,-1), 12),
        ("RIGHTPADDING",  (0,0), (-1,-1), 12),
        ("TOPPADDING",    (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
        ("BOX",           (0,0), (-1,-1), 1, DOURADO),
        ("ROUNDEDCORNERS", [4,4,4,4]),
    ]))
    story.append(obs_box)
    story.append(Spacer(1, 14))

    # ════════════════════════════════════════
    # RODAPE
    # ════════════════════════════════════════
    story.append(LinhaColorida(AZUL_MEDIO, 1, W))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Tavares Gesso - Montador de Drywall  |  Lauro de Freitas - BA  |  "
        "Documento gerado automaticamente pelo GessoBot",
        st["rodape"]
    ))

    doc.build(story)
    print("PDF gerado com sucesso: " + output_path)


# ── EXECUCAO VIA NODE ────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) > 2:
        json_path   = sys.argv[1]
        output_path = sys.argv[2]
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                dados_cliente = json.load(f)
            gerar_pdf(dados_cliente, output_path)
        except Exception as e:
            print("Erro interno no Python: " + str(e))
            sys.exit(1)
    else:
        print("Erro: Faltam os caminhos do JSON e do PDF.")
        sys.exit(1)
