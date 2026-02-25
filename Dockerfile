# 1. Imagem Base
# Usamos uma imagem oficial e leve do Nginx. Nginx é um servidor web
# de alta performance, perfeito para servir arquivos estáticos (HTML, CSS, JS).
# A versão 'alpine' é minúscula, o que torna o deploy mais rápido.
FROM nginx:alpine

# 2. Copiar os Arquivos
# Copiamos todo o conteúdo da pasta atual do seu projeto (representada pelo '.')
# para o diretório padrão onde o Nginx serve os arquivos dentro do container.
# Isso inclui seu index.html, index.js, e as pastas 'src' e 'public'.
COPY . /usr/share/nginx/html

# 3. Expor a Porta
# Informamos que o container vai escutar na porta 80. O Railway vai
# automaticamente direcionar o tráfego da internet para esta porta.
EXPOSE 80

# 4. Comando de Execução (Opcional aqui)
# A imagem base 'nginx:alpine' já tem um comando padrão para iniciar o servidor,
# então não precisamos especificar um aqui. O Nginx iniciará automaticamente.
