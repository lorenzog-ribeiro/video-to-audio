process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import axios from 'axios';

const default_path = process.env.WIKIJS_DEFAULT_PATH || '';
const wiki_base = process.env.WIKIJS_URL;
const wiki_token = process.env.WIKIJS_API_KEY;

// Função original para criar uma página individual
export async function createPage(pageData: {
    title: string;
    path: string;
    content: string;
    description?: string;
    editor?: string;
    isPrivate?: boolean;
    isPublished?: boolean;
    locale?: string;
    tags?: string[];
}) {
    // Debug e validação
    console.log("🔍 pageData recebido:", pageData);

    if (!pageData) {
        throw new Error("pageData é obrigatório");
    }

    if (!pageData.title) {
        throw new Error("pageData.title é obrigatório");
    }

    if (!pageData.path) {
        throw new Error("pageData.path é obrigatório");
    }

    if (!pageData.content) {
        throw new Error("pageData.content é obrigatório");
    }

    const CREATE_PAGE = `
      mutation CreatePage(
        $content: String!
        $description: String!
        $editor: String!
        $isPrivate: Boolean!
        $isPublished: Boolean!
        $locale: String!
        $path: String!
        $tags: [String]!
        $title: String!
      ) {
        pages {
          create(
            content: $content
            description: $description
            editor: $editor
            isPrivate: $isPrivate
            isPublished: $isPublished
            locale: $locale
            path: $path
            tags: $tags
            title: $title
          ) {
            responseResult {
              succeeded
              errorCode
              slug
              message
            }
            page {
              id
              title
              path
            }
          }
        }
      }
    `;

    const variables = {
        title: pageData.title,
        path: pageData.path,
        content: pageData.content,
        description: pageData.description || "",
        editor: pageData.editor || "markdown",
        isPrivate: pageData.isPrivate || false,
        isPublished: pageData.isPublished !== false,
        locale: pageData.locale || "en",
        tags: pageData.tags || []
    };

    const body = {
        query: CREATE_PAGE,
        variables: variables
    };

    try {
        const resp = await axios({
            method: 'POST',
            url: wiki_base!,
            data: body,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${wiki_token}`
            },
            maxRedirects: 0
        });

        if (resp.data.data?.pages?.create?.responseResult?.succeeded) {
            console.log("🎉 Página criada com sucesso!");
            console.log("📄 Página:", resp.data.data.pages.create.page);
            return resp.data.data.pages.create;
        } else {
            console.error("❌ Erro ao criar página:", resp.data.data?.pages?.create?.responseResult?.message);
            throw new Error(resp.data.data?.pages?.create?.responseResult?.message || "Erro desconhecido");
        }

    } catch (err: any) {
        console.error("❌ Erro na requisição:", err.response?.status, err.response?.data || err.message);
        throw err;
    }
}

// Função para extrair metadados do arquivo markdown
function extractMarkdownMetadata(content: string): { title: string; description: string; tags: string[]; cleanContent: string; } {
    let title = '';
    let description = '';
    let tags: string[] = [];
    let cleanContent = content;

    // Verificar se há frontmatter YAML
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        cleanContent = frontmatterMatch[2];

        // Extrair título do frontmatter
        const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
        if (titleMatch) {
            title = titleMatch[1].replace(/['"]/g, '').trim();
        }

        // Extrair descrição do frontmatter
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
        if (descMatch) {
            description = descMatch[1].replace(/['"]/g, '').trim();
        }

        // Extrair tags do frontmatter
        const tagsMatch = frontmatter.match(/^tags:\s*\[(.*)\]$/m);
        if (tagsMatch) {
            tags = tagsMatch[1].split(',').map(tag => tag.replace(/['"]/g, '').trim()).filter(tag => tag);
        }
    }

    // Se não encontrou título no frontmatter, usar o primeiro H1
    if (!title) {
        const h1Match = cleanContent.match(/^#\s+(.+)$/m);
        if (h1Match) {
            title = h1Match[1].trim();
        }
    }

    // Se ainda não tem título, usar o nome do arquivo (será passado como fallback)
    if (!title) {
        title = 'Documento sem título';
    }

    // Se não tem descrição, usar as primeiras linhas do conteúdo
    if (!description) {
        const firstParagraph = cleanContent
            .replace(/^#.*$/gm, '') // Remove headers
            .trim()
            .split('\n\n')[0]
            .replace(/\n/g, ' ')
            .substring(0, 150);

        description = firstParagraph || 'Documento gerado automaticamente';
    }

    return { title, description, tags, cleanContent };
}

// Função para gerar path único baseado no título
function generateWikiPath(title: string, basePath: string = ''): string {
    // Limpar o título para criar um path válido
    let path = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove caracteres especiais
        .replace(/\s+/g, '-') // Substitui espaços por hífens
        .replace(/-+/g, '-') // Remove hífens duplicados
        .replace(/^-|-$/g, ''); // Remove hífens do início e fim

    // Adicionar prefixo se fornecido
    if (basePath) {
        path = `${basePath}/${path}`;
    } else {
        path = `/${path}`;
    }

    return path;
}

// NOVA FUNÇÃO: Processar todos os arquivos markdown
export async function processAllMarkdownFiles(markdownDir?: string): Promise<{ successful: number; failed: number; errors: Array<{ file: string; error: string }>; }> {
    const results = {
        successful: 0,
        failed: 0,
        errors: [] as Array<{ file: string; error: string }>
    };

    try {
        // Usar diretório padrão se não fornecido
        const sourceDir = markdownDir || path.resolve(__dirname, '../../working-paths/markdown');

        console.log(`📁 Procurando arquivos markdown em: ${sourceDir}`);

        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Diretório não encontrado: ${sourceDir}`);
        }

        // Listar todos os arquivos .md
        const files = fs.readdirSync(sourceDir).filter(file =>
            file.endsWith('.md') && !file.endsWith('_error.md') // Ignorar arquivos de erro
        );

        if (files.length === 0) {
            console.log('📭 Nenhum arquivo markdown encontrado');
            return results;
        }

        console.log(`📊 Encontrados ${files.length} arquivos markdown para processar\n`);

        // Processar cada arquivo
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.join(sourceDir, file);

            try {
                console.log(`🔄 Processando ${i + 1}/${files.length}: ${file}`);

                // Ler conteúdo do arquivo
                const rawContent = fs.readFileSync(filePath, 'utf-8');

                if (!rawContent.trim()) {
                    console.log(`   ⚠️ Arquivo vazio, pulando...`);
                    results.failed++;
                    results.errors.push({ file, error: 'Arquivo vazio' });
                    continue;
                }

                // Extrair metadados
                const { title, description, tags, cleanContent } = extractMarkdownMetadata(rawContent);

                // Usar nome do arquivo como fallback para título
                const finalTitle = title || path.basename(file, '.md').replace(/_/g, ' ');

                // Gerar path único
                const wikiPath = generateWikiPath(finalTitle, default_path);

                console.log(`   📝 Título: ${finalTitle}`);
                console.log(`   🔗 Path: ${wikiPath}`);
                console.log(`   📄 Descrição: ${description.substring(0, 50)}...`);
                console.log(`   🏷️ Tags: [${tags.join(', ')}]`);

                // Criar página no wiki
                await createPage({
                    title: finalTitle,
                    path: wikiPath,
                    content: cleanContent,
                    description: description,
                    editor: 'markdown',
                    isPrivate: false,
                    isPublished: true,
                    locale: 'en',
                    tags: tags
                });

                console.log(`   ✅ Página criada com sucesso!\n`);
                results.successful++;

                // Pequena pausa entre requisições para não sobrecarregar a API
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error: any) {
                console.error(`   ❌ Erro ao processar ${file}:`, error.message);
                results.failed++;
                results.errors.push({
                    file,
                    error: error.message || 'Erro desconhecido'
                });
                console.log(''); // Linha em branco para separar
            }
        }

        // Relatório final
        console.log('\n' + '='.repeat(50));
        console.log('📊 RELATÓRIO FINAL DO WIKI.JS');
        console.log('='.repeat(50));
        console.log(`✅ Páginas criadas com sucesso: ${results.successful}/${files.length}`);
        console.log(`❌ Falhas: ${results.failed}/${files.length}`);

        if (results.errors.length > 0) {
            console.log('\n❌ Arquivos com erro:');
            results.errors.forEach(({ file, error }) => {
                console.log(`   - ${file}: ${error}`);
            });
        }

        console.log(`\n🔗 Acesse seu Wiki.js: ${wiki_base?.replace('/graphql', '')}`);

    } catch (error: any) {
        console.error('❌ Erro fatal no processamento:', error.message);
        throw error;
    }

    return results;
}

// Função de conveniência para usar no endpoint
export async function insertAllMarkdownToWiki(): Promise<void> {
    try {
        const results = await processAllMarkdownFiles();

        if (results.successful === 0 && results.failed > 0) {
            throw new Error(`Falha ao processar todos os arquivos. Veja os logs acima.`);
        }

        console.log(`🎉 Processamento concluído! ${results.successful} páginas criadas no Wiki.js`);
    } catch (error) {
        console.error('❌ Erro no processamento batch:', error);
        throw error;
    }
}