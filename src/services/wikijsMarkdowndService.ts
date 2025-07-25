process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import axios from 'axios';

const default_path = process.env.WIKIJS_DEFAULT_PATH || '';
const wiki_base = process.env.WIKIJS_URL;
const wiki_token = process.env.WIKIJS_API_KEY;

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
    if (!pageData) {
        throw new Error("pageData é obrigatório");
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
            return `🎉 Página criada com sucesso! ${resp.data.data.pages.create}`;
        } else {
            throw new Error(resp.data.data?.pages?.create?.responseResult?.message || "Erro desconhecido");
        }

    } catch (err: any) {
        console.error("❌ Erro na requisição:", err.response?.status, err.response?.data || err.message);
        throw err;
    }
}

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

    return { title, description, tags, cleanContent };
}

function generateWikiPath(title: string, basePath: string = ''): string {
    // Limpar o título para criar um path válido
    let path = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // Adicionar prefixo se fornecido
    if (basePath) {
        path = `${basePath}/${path}`;
    } else {
        path = `/${path}`;
    }

    return path;
}

export async function processAllMarkdownFiles(markdownDir?: string): Promise<{ successful: number; failed: number; errors: Array<{ file: string; error: string }>; }> {
    const results = {
        successful: 0,
        failed: 0,
        errors: [] as Array<{ file: string; error: string }>
    };

    try {
        // Usar diretório padrão se não fornecido
        const sourceDir = markdownDir || path.resolve(__dirname, '../../working-paths/markdown');

        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Diretório não encontrado: ${sourceDir}`);
        }

        const files = fs.readdirSync(sourceDir).filter(file => file.endsWith('.md'));

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.join(sourceDir, file);

            try {
                const rawContent = fs.readFileSync(filePath, 'utf-8');

                if (!rawContent.trim()) {
                    results.failed++;
                    results.errors.push({ file, error: 'Arquivo vazio' });
                    continue;
                }

                const { title, description, tags, cleanContent } = extractMarkdownMetadata(rawContent);

                const finalTitle = title || path.basename(file, '.md').replace(/_/g, ' ');

                const wikiPath = generateWikiPath(finalTitle, default_path);

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

                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error: any) {
                results.failed++;
                results.errors.push({
                    file,
                    error: ` ❌ Erro ao processar ${file}: ${error.message} ` || 'Erro desconhecido'
                });
            }
        }

        console.log(`✅ Páginas criadas com sucesso: ${results.successful}/${files.length}`);
        console.log(`❌ Falhas: ${results.failed}/${files.length}`);

    } catch (error: any) {
        throw `❌ Erro fatal no processamento: ${error.message}`;
    }

    return results;
}

export async function insertAllMarkdownToWiki(): Promise<void> {
    try {
        const results = await processAllMarkdownFiles();

        if (results.successful === 0 && results.failed > 0)
            throw new Error(`Falha ao processar todos os arquivos. Veja os logs acima.`);
    }
    catch (error) {
        console.error('❌ Erro no processamento batch:', error);
        throw error;
    }
}