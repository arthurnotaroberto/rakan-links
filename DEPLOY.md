# Publicar o site de links — `links.rakan-invest.com`

Site estático (1 arquivo: `index.html`). Não tem build, não tem servidor. É só hospedar.

---

## Passo 1 — Subir na Vercel (via GitHub, sem terminal)

1. **Criar o repositório:** acesse https://github.com/new
   - Repository name: `rakan-links`
   - Deixe **Public** (ou Private, tanto faz). **Não** marque "Add a README".
   - Clique em **Create repository**.
2. **Subir os arquivos (pelo navegador):** na página do repositório vazio, clique no link
   **"uploading an existing file"**. Arraste os arquivos `index.html` e `DEPLOY.md`
   (da pasta `C:\dev\rakan-links`) para a área de upload e clique em **Commit changes**.
3. **Importar na Vercel:** acesse https://vercel.com/new → **Import Git Repository** →
   escolha o `rakan-links` → **Deploy**. Em ~30s sai uma URL `...vercel.app`.
4. Abra essa URL e confirme que a página apareceu certa.

> Vantagem: qualquer alteração futura que eu fizer e você subir no GitHub atualiza o site sozinha.

*(Alternativa técnica, se você tiver Node: na pasta, `npx vercel --prod` e seguir o login.)*

---

## Passo 2 — Ligar o domínio `links.rakan-invest.com`

1. No projeto da Vercel → **Settings → Domains** → digite `links.rakan-invest.com` → **Add**.
2. A Vercel vai mostrar o que configurar no DNS:
   - **Se o DNS do rakan-invest.com já está na Vercel** (provável, já que o app usa `app.rakan-invest.com`): ela adiciona sozinha — é só confirmar. Pronto.
   - **Se o DNS está em outro lugar** (registrador/Cloudflare): adicione um registro **CNAME**:
     - Nome/Host: `links`
     - Valor/Destino: `cname.vercel-dns.com`
3. Aguarde alguns minutos. A Vercel emite o **certificado HTTPS automático**. Quando ficar verde, `https://links.rakan-invest.com` está no ar.

> O `app.rakan-invest.com` não é afetado por nada disso — é um projeto separado.

---

## Pendências (assets que faltam — trocar quando tiver)

| Item | Onde no arquivo | O que fazer |
|------|-----------------|-------------|
| Foto de perfil | `<div class="avatar">AN</div>` | Trocar o "AN" por `<img src="foto.jpg" alt="Arthur Notaroberto">` e subir `foto.jpg` na pasta |
| Imagem do Planejamento | `<div class="card-hero-img">[ imagem... ]</div>` | Trocar por `<img>` da imagem real |
| Imagem de compartilhamento | meta `og:image` | Subir `og-image.png` (1200×630) na pasta — é a prévia que aparece ao mandar o link no WhatsApp |
| Link do YouTube | `<a href="#" ...YouTube>` | Trocar `#` pelo canal quando existir |
| Número do WhatsApp | `href="https://wa.me/5511981940543"` | Confirmar se é o número de atendimento certo |

Qualquer uma dessas trocas eu faço pra você — é só me mandar o asset/decisão.

---

## O que eu já ajustei em relação ao protótipo (sem mudar o visual)

- **Meta tags de compartilhamento** (Open Graph/Twitter) — pré-visualização ao mandar o link em redes/WhatsApp.
- **Favicon** placeholder (círculo terracota) — trocar pela logo quando houver.
- **Segurança** nos links externos (`rel="noopener noreferrer"`).
- **Hover** discreto nos botões (só em desktop; mobile intacto).
- Suporte a `<img>` no avatar (pronto pra receber a foto).
- Copy, estrutura, cores e os links (Instagram/LinkedIn/WhatsApp) — **idênticos ao que vocês validaram**.
