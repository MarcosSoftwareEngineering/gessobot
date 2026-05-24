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

    def draw(self):
        w = self._largura or self.canv._pagesize[0] - 4*cm
        self.canv.setStrokeColor(self.cor)
        self.canv.setLineWidth(self.espessura)
        self.canv.line(0, self.espessura/2, w, self.espessura/2)

# ── Engenharia de Imagens (Tratamento via PIL) ───────────────
def cortar_circular(img_path, tamanho=180):
    """Recorta imagem no centro e aplica máscara circular anti-aliased."""
    img = PILImage.open(img_path).convert("RGBA")
    
    # Crop central para garantir proporção 1:1 sem achatar a logo
    min_dim = min(img.size)
    left = (img.width - min_dim) / 2
    top = (img.height - min_dim) / 2
    img = img.crop((left, top, left + min_dim, top + min_dim))
    img = img.resize((tamanho, tamanho), PILImage.Resampling.LANCZOS)
    
    # Máscara circular
    mask = PILImage.new("L", (tamanho, tamanho), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, tamanho, tamanho), fill=255)
    
    result = PILImage.new("RGBA", (tamanho, tamanho), (255, 255, 255, 0))
    result.paste(img, (0, 0), mask)
    
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    buf.seek(0)
    return buf

def preparar_imagem_portfolio(img_path, largura, altura):
    """Processa as fotos do portfólio via crop central (object-fit: cover)."""
    try:
        img = PILImage.open(img_path).convert("RGB")
        img_ratio = img.width / img.height
        target_ratio = largura / altura
        
        if img_ratio > target_ratio:
            new_w = int(target_ratio * img.height)
            left = (img.width - new_w) / 2
            img = img.crop((left, 0, left + new_w, img.height))
        else:
            new_h = int(img.width / target_ratio)
            top = (img.height - new_h) / 2
            img = img.crop((0, top, img.width, top + new_h))
            
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        buf.seek(0)
        return RLImage(buf, width=largura, height=altura)
    except Exception as e:
        return Paragraph(f"Erro na imagem", estilos()["obs"])

# ── Motor do PDF ─────────────────────────────────────────────
def gerar_pdf(dados: dict, output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.5*cm, bottomMargin=2*cm
    )

    st = estilos()
    story = []
    W = A4[0] - 3.6*cm  

    # ════════════════════════════════════════
    # CABEÇALHO 
    # ════════════════════════════════════════
    logo_buf = cortar_circular("src/assets/Tavares_Gesso.jpeg", 150) 
    logo_img = RLImage(logo_buf, width=3.2*cm, height=3.2*cm)

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

    header_table = Table(header_data, colWidths=[3.8*cm, W - 3.8*cm - 4*cm, 4*cm])
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
    # PORTFÓLIO (Grade 2x2 Refatorada)
    # ════════════════════════════════════════
    story.append(Paragraph("📸  NOSSO PORTFÓLIO", st["titulo_secao"]))
    story.append(LinhaColorida(AZUL_MEDIO, 1.5, W))
    story.append(Spacer(1, 8))

    # Calcula dimensões proporcionais para a tabela 2x2
    largura_img = (W / 2) - 0.2*cm 
    altura_img = 5.0*cm

    # Imagens do sistema mapeadas exatamente como nos arquivos
    img_grid = [
        [
            preparar_imagem_portfolio("src/assets/El.03.jpeg", largura_img, altura_img),
            preparar_imagem_portfolio("src/assets/El.04.jpeg", largura_img, altura_img)
        ],
        [
            preparar_imagem_portfolio("src/assets/E.l09.jpeg", largura_img, altura_img),
            preparar_imagem_portfolio("src/assets/El.07.jpeg", largura_img, altura_img)
        ]
    ]

    tabela_portfolio = Table(img_grid, colWidths=[W/2, W/2])
    tabela_portfolio.setStyle(TableStyle([
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
    ]))
    
    story.append(tabela_portfolio)
    story.append(Spacer(1, 8))
    
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
    # OBSERVAÇÕES E RODAPÉ
    # ════════════════════════════════════════
    obs_box = Table([[
        Paragraph(
            "⚠️ <b>Observações:</b> Orçamento válido por 15 dias. "
            "Valores sujeitos a alteração após vistoria técnica in loco. "
            "Não inclui pintura, elétrica ou outras especialidades.",
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

    story.append(LinhaColorida(AZUL_MEDIO, 1, W))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Tavares Gesso — Montador de Drywall  •  📍 Lauro de Freitas - BA  •  Este documento foi gerado automaticamente pelo GessoBot",
        st["rodape"]
    ))

    doc.build(story)
    print(f"✅ PDF gerado: {output_path}")

# ── EXECUÇÃO VIA NODE ────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) > 2:
        json_path = sys.argv[1]
        output_path = sys.argv[2]
        
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                dados_cliente = json.load(f)
                
            gerar_pdf(dados_cliente, output_path)
        except Exception as e:
            print(f"Erro interno no Python: {e}")
            sys.exit(1)
    else:
        print("Erro: Faltam os caminhos do JSON e do PDF.")
        sys.exit(1)