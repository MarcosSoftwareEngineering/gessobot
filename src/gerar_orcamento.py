"""
gerar_orcamento.py
Gera PDF profissional de orçamento para Tavares Gesso
"""

import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image, KeepTogether
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import Flowable
from reportlab.lib.colors import HexColor
from PIL import Image as PILImage
import io

# ── Paleta de cores ──────────────────────────────────────────
AZUL_ESCURO  = HexColor("#0D2B6E")
AZUL_MEDIO   = HexColor("#1A4DB5")
AZUL_CLARO   = HexColor("#4A90D9")
CINZA_ESCURO = HexColor("#2C2C2C")
CINZA_MEDIO  = HexColor("#555555")
CINZA_CLARO  = HexColor("#F2F4F8")
BRANCO       = HexColor("#FFFFFF")
DOURADO      = HexColor("#C8A94A")
VERDE        = HexColor("#1A7A4A")

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
            fontName="Helvetica-Bold", fontSize=13,
            textColor=BRANCO, alignment=TA_LEFT, leading=18),
        "total_valor": ParagraphStyle("total_valor",
            fontName="Helvetica-Bold", fontSize=18,
            textColor=DOURADO, alignment=TA_RIGHT, leading=22),
        "obs": ParagraphStyle("obs",
            fontName="Helvetica-Oblique", fontSize=8,
            textColor=CINZA_MEDIO, alignment=TA_LEFT, leading=12),
    }


class LinhaColorida(Flowable):
    """Linha horizontal colorida personalizada."""
    def __init__(self, cor, espessura=2, largura=None):
        super().__init__()
        self.cor = cor
        self.espessura = espessura
        self._largura = largura
        self.height = espessura + 4

    def draw(self):
        w = self._largura or self.canv._pagesize[0] - 4*cm
        self.canv.setStrokeColor(self.cor)
        self.canv.setLineWidth(self.espessura)
        self.canv.line(0, self.espessura/2, w, self.espessura/2)


def cortar_circular(img_path, tamanho=180):
    """Recorta imagem em círculo para logo."""
    img = PILImage.open(img_path).convert("RGBA")
    img = img.resize((tamanho, tamanho), PILImage.LANCZOS)
    mask = PILImage.new("L", (tamanho, tamanho), 0)
    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, tamanho, tamanho), fill=255)
    result = PILImage.new("RGBA", (tamanho, tamanho), (255, 255, 255, 0))
    result.paste(img, (0, 0), mask)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    buf.seek(0)
    return buf


def gerar_pdf(dados: dict, output_path: str):
    """
    dados = {
        "nome": "João Silva",
        "telefone": "71 99999-9999",
        "servico": "Forro de Gesso Liso",
        "metragem": 25,
        "ambiente": "Sala de estar",
        "acabamento": "Padrão",
        "localizacao": "Lauro de Freitas - BA",
        "subtotal": 1625.0,
        "desconto": 5,
        "valor_desconto": 81.25,
        "total": 1543.75,
        "prazo": "3 a 5 dias úteis",
        "itens": [
            {"descricao": "Mão de obra - Forro Liso", "qtd": 25, "un": "m²", "unit": 47.0, "total": 1175.0},
            {"descricao": "Material (gesso, perfis)", "qtd": 1, "un": "kit", "unit": 450.0, "total": 450.0},
        ]
    }
    """
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.5*cm, bottomMargin=2*cm
    )

    st = estilos()
    story = []
    W = A4[0] - 3.6*cm  # largura útil

    # ════════════════════════════════════════
    # CABEÇALHO com gradiente simulado
    # ════════════════════════════════════════
    logo_buf = cortar_circular("logo.png", 130)
    logo_img = Image(logo_buf, width=3.2*cm, height=3.2*cm)

    header_data = [[
        logo_img,
        [
            Paragraph("Tavares Gesso", st["empresa"]),
            Paragraph("Montador de Drywall • Forro • Sancas • Gesso 3D", st["slogan"]),
            Spacer(1, 6),
            Paragraph("✦ Qualidade e Elegância em Cada Projeto", st["slogan"]),
        ],
        [
            Paragraph(f"<b>ORÇAMENTO</b>", ParagraphStyle("orcnum",
                fontName="Helvetica-Bold", fontSize=9,
                textColor=DOURADO, alignment=TA_RIGHT)),
            Paragraph(f"Nº {datetime.now().strftime('%Y%m%d%H%M')}", ParagraphStyle("orcnum2",
                fontName="Helvetica-Bold", fontSize=12,
                textColor=BRANCO, alignment=TA_RIGHT)),
            Spacer(1, 8),
            Paragraph(datetime.now().strftime("%d/%m/%Y"), ParagraphStyle("data",
                fontName="Helvetica", fontSize=9,
                textColor=HexColor("#A8C4E8"), alignment=TA_RIGHT)),
        ]
    ]]

    header_table = Table(header_data, colWidths=[3.5*cm, W - 3.5*cm - 4*cm, 4*cm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), AZUL_ESCURO),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 14),
        ("BOTTOMPADDING", (0,0), (-1,-1), 14),
        ("ROUNDEDCORNERS", [8,8,8,8]),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 14))

    # ════════════════════════════════════════
    # DADOS DO CLIENTE
    # ════════════════════════════════════════
    story.append(Paragraph("👤  DADOS DO CLIENTE", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    cliente_data = [
        [Paragraph("Nome", st["label"]), Paragraph(dados.get("nome","—"), st["valor"]),
         Paragraph("Telefone", st["label"]), Paragraph(dados.get("telefone","—"), st["valor"])],
        [Paragraph("Localização", st["label"]), Paragraph(dados.get("localizacao","—"), st["valor"]),
         Paragraph("Ambiente", st["label"]), Paragraph(dados.get("ambiente","—"), st["valor"])],
    ]
    ct = Table(cliente_data, colWidths=[2.8*cm, W/2-2.8*cm, 2.8*cm, W/2-2.8*cm])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CINZA_CLARO),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("GRID", (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
        ("ROUNDEDCORNERS", [4,4,4,4]),
    ]))
    story.append(ct)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # DETALHES DO SERVIÇO
    # ════════════════════════════════════════
    story.append(Paragraph("🏗️  DETALHES DO SERVIÇO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    servico_data = [
        [Paragraph("Serviço", st["label"]),
         Paragraph(dados.get("servico","—"), st["valor"]),
         Paragraph("Metragem", st["label"]),
         Paragraph(f"{dados.get('metragem','—')} m²", st["valor"])],
        [Paragraph("Acabamento", st["label"]),
         Paragraph(dados.get("acabamento","Padrão"), st["valor"]),
         Paragraph("Prazo Estimado", st["label"]),
         Paragraph(dados.get("prazo","—"), st["valor"])],
    ]
    st2 = Table(servico_data, colWidths=[2.8*cm, W/2-2.8*cm, 2.8*cm, W/2-2.8*cm])
    st2.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CINZA_CLARO),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("GRID", (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(st2)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # TABELA DE ITENS
    # ════════════════════════════════════════
    story.append(Paragraph("📋  ITENS DO ORÇAMENTO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    header_row = [
        Paragraph("<b>Descrição</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
            fontSize=9, textColor=BRANCO, alignment=TA_LEFT)),
        Paragraph("<b>Qtd</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
            fontSize=9, textColor=BRANCO, alignment=TA_CENTER)),
        Paragraph("<b>Un</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
            fontSize=9, textColor=BRANCO, alignment=TA_CENTER)),
        Paragraph("<b>Unit. (R$)</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
            fontSize=9, textColor=BRANCO, alignment=TA_RIGHT)),
        Paragraph("<b>Total (R$)</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
            fontSize=9, textColor=BRANCO, alignment=TA_RIGHT)),
    ]

    itens = dados.get("itens", [])
    rows = [header_row]
    for i, item in enumerate(itens):
        bg = CINZA_CLARO if i % 2 == 0 else BRANCO
        rows.append([
            Paragraph(item["descricao"], ParagraphStyle("td", fontName="Helvetica",
                fontSize=9, textColor=CINZA_ESCURO, alignment=TA_LEFT)),
            Paragraph(str(item["qtd"]), ParagraphStyle("td", fontName="Helvetica",
                fontSize=9, textColor=CINZA_ESCURO, alignment=TA_CENTER)),
            Paragraph(item["un"], ParagraphStyle("td", fontName="Helvetica",
                fontSize=9, textColor=CINZA_ESCURO, alignment=TA_CENTER)),
            Paragraph(f"R$ {item['unit']:,.2f}".replace(",","X").replace(".",",").replace("X","."),
                ParagraphStyle("td", fontName="Helvetica", fontSize=9,
                textColor=CINZA_ESCURO, alignment=TA_RIGHT)),
            Paragraph(f"R$ {item['total']:,.2f}".replace(",","X").replace(".",",").replace("X","."),
                ParagraphStyle("td", fontName="Helvetica-Bold", fontSize=9,
                textColor=AZUL_ESCURO, alignment=TA_RIGHT)),
        ])

    col_w = [W-9.5*cm, 1.8*cm, 1.5*cm, 3*cm, 3.2*cm]
    itens_table = Table(rows, colWidths=col_w)
    itens_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), AZUL_ESCURO),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LINEBELOW", (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
        ("LINEAFTER", (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(itens_table)
    story.append(Spacer(1, 10))

    # ════════════════════════════════════════
    # TOTAIS
    # ════════════════════════════════════════
    subtotal = dados.get("subtotal", 0)
    desconto_pct = dados.get("desconto", 0)
    valor_desc = dados.get("valor_desconto", 0)
    total = dados.get("total", 0)

    def fmt(v): return f"R$ {v:,.2f}".replace(",","X").replace(".",",").replace("X",".")

    totais_data = [
        [Paragraph("Subtotal:", ParagraphStyle("sl", fontName="Helvetica", fontSize=9,
            textColor=CINZA_MEDIO, alignment=TA_RIGHT)),
         Paragraph(fmt(subtotal), ParagraphStyle("sv", fontName="Helvetica", fontSize=9,
            textColor=CINZA_ESCURO, alignment=TA_RIGHT))],
        [Paragraph(f"Desconto ({desconto_pct}%):", ParagraphStyle("sl", fontName="Helvetica",
            fontSize=9, textColor=VERDE, alignment=TA_RIGHT)),
         Paragraph(f"- {fmt(valor_desc)}", ParagraphStyle("sv", fontName="Helvetica",
            fontSize=9, textColor=VERDE, alignment=TA_RIGHT))],
    ]

    totais_table = Table(totais_data, colWidths=[W-4*cm, 4*cm])
    totais_table.setStyle(TableStyle([
        ("ALIGN", (0,0), (-1,-1), "RIGHT"),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(totais_table)
    story.append(Spacer(1, 6))

    # Box do total final
    total_box = Table([
        [Paragraph("VALOR TOTAL:", st["total_label"]),
         Paragraph(fmt(total), st["total_valor"])]
    ], colWidths=[W/2, W/2])
    total_box.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), AZUL_ESCURO),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 16),
        ("RIGHTPADDING", (0,0), (-1,-1), 16),
        ("TOPPADDING", (0,0), (-1,-1), 12),
        ("BOTTOMPADDING", (0,0), (-1,-1), 12),
        ("ROUNDEDCORNERS", [6,6,6,6]),
    ]))
    story.append(total_box)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # PORTFÓLIO
    # ════════════════════════════════════════
    story.append(Paragraph("📸  NOSSO PORTFÓLIO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    portfolio_img = Image("portfolio.jpeg", width=W, height=7*cm)
    portfolio_img.hAlign = "CENTER"
    story.append(portfolio_img)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Acabamentos premium com design exclusivo • Forro liso • Drywall • Sancas • Gesso 3D",
        ParagraphStyle("port_leg", fontName="Helvetica-Oblique", fontSize=8,
            textColor=CINZA_MEDIO, alignment=TA_CENTER)
    ))
    story.append(Spacer(1, 14))

    # ════════════════════════════════════════
    # GARANTIAS E CONDIÇÕES
    # ════════════════════════════════════════
    garantias = [
        ["✅  Visita técnica inclusa", "🔒  Garantia de 1 ano"],
        ["📐  Medição e projeto gratuitos", "⭐  Materiais de alta qualidade"],
        ["🚀  Equipe especializada", "📞  Suporte pós-obra"],
    ]
    g_table = Table(garantias, colWidths=[W/2, W/2])
    g_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CINZA_CLARO),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [CINZA_CLARO, BRANCO]),
        ("FONTNAME", (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("TEXTCOLOR", (0,0), (-1,-1), CINZA_ESCURO),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 7),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("GRID", (0,0), (-1,-1), 0.3, HexColor("#DDDDDD")),
    ]))
    story.append(garantias := g_table)
    story.append(Spacer(1, 14))

    # ════════════════════════════════════════
    # OBSERVAÇÕES
    # ════════════════════════════════════════
    obs_box = Table([[
        Paragraph(
            "⚠️ <b>Observações:</b> Orçamento válido por 15 dias. "
            "Valores sujeitos a alteração após vistoria técnica in loco. "
            "Não inclui pintura, elétrica ou outras especialidades. "
            "Pagamento: 50% na assinatura + 50% na entrega.",
            st["obs"])
    ]], colWidths=[W])
    obs_box.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), HexColor("#FFF8E7")),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
        ("BOX", (0,0), (-1,-1), 1, DOURADO),
        ("ROUNDEDCORNERS", [4,4,4,4]),
    ]))
    story.append(obs_box)
    story.append(Spacer(1, 16))

    # ════════════════════════════════════════
    # RODAPÉ
    # ════════════════════════════════════════
    story.append(LinhaColorida(AZUL_MEDIO, 1, W))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Tavares Gesso — Montador de Drywall  •  "
        "📍 Lauro de Freitas - BA  •  "
        "Este documento foi gerado automaticamente pelo GessoBot",
        st["rodape"]
    ))

    doc.build(story)
    print(f"✅ PDF gerado: {output_path}")


# ── TESTE ────────────────────────────────────────────────────
if __name__ == "__main__":
    dados_teste = {
        "nome": "Carlos Andrade",
        "telefone": "71 98765-4321",
        "servico": "Forro de Gesso Liso",
        "metragem": 30,
        "ambiente": "Sala de Estar",
        "acabamento": "Premium",
        "localizacao": "Lauro de Freitas - BA",
        "subtotal": 2175.0,
        "desconto": 5,
        "valor_desconto": 108.75,
        "total": 2066.25,
        "prazo": "3 a 5 dias úteis",
        "itens": [
            {"descricao": "Mão de obra — Forro de Gesso Liso", "qtd": 30, "un": "m²", "unit": 47.0, "total": 1410.0},
            {"descricao": "Material (gesso, perfis, buchas e pregos)", "qtd": 1, "un": "kit", "unit": 445.0, "total": 445.0},
            {"descricao": "Arremate e acabamento fino", "qtd": 1, "un": "svc", "unit": 320.0, "total": 320.0},
        ]
    }
    gerar_pdf(dados_teste, "/home/claude/orcamento_teste.pdf")
