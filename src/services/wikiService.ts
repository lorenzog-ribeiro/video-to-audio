process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import axios from 'axios';
import mammoth from 'mammoth';


const default_path = process.env.WIKIJS_DEFAULT_PATH;
const wiki_base = process.env.WIKIJS_URL;
const wiki_token = process.env.WIKIJS_API_KEY;

export async function upsertWikiPage(markdownDir: string) {
    const markdownFiles = fs.readdirSync(markdownDir);

    for (let mdFiles of markdownFiles) {
        const filePath = path.join(markdownDir, mdFiles);
        const content = await readFileContent(filePath);

        const fileNameWithoutExt = path.basename(mdFiles, '.md');
        const isSummary = mdFiles.includes('_summary');

        let cleanFileName = fileNameWithoutExt
            .replace(/_summary$/, '')
            .replace(/_error$/, '')
            .replace(/[-_]/g, ' ');

        let title = cleanFileName;
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (titleMatch) {
            title = titleMatch[1];
        }
        const payload = {
            title: title,
            content: content,
            content_format: 'markdown',
            path: `${default_path}`,
        }

        console.log(payload);

        try {
            const res = await axios.post(
                `${wiki_base}/graphql/pages/`, // endpoint de criação
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${wiki_token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Página criada:', res.data.path);
            return res.data;
        } catch (err: any) {
            // Se a página já existir, você pode capturar o erro 409 e chamar o endpoint de update:
            if (err.response?.status === 409) {
                // buscar pageId existente e chamar PUT /api/pages/:id
                const pageId = err.response.data.details.pageId;
                return updateWikiPage(pageId, payload);
            }
            throw err;
        }
    }
}

async function updateWikiPage(pageId: string, payload: {}) {
    const res = await axios.put(
        `${wiki_base}/graphql/pages/${pageId}`,
        payload,
        { headers: { Authorization: `Bearer ${wiki_token}` } }
    );
    console.log('Página atualizada:', res.data.path);
    return res.data;
}



async function readFileContent(filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase();

    try {
        switch (extension) {
            case '.md':
                const mdContent = fs.readFileSync(filePath, 'utf-8');
                // Clean up markdown content
                return mdContent
                    .replace(/```[\s\S]*?```/g, '[CODE BLOCK]') // Replace code blocks
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links
                    .trim();

            case '.docx':
                const result = await mammoth.extractRawText({ path: filePath });
                // Clean up docx content
                return result.value
                    .replace(/\r\n/g, '\n') // Normalize line endings
                    .replace(/\t/g, '  ') // Replace tabs with spaces
                    .trim();

            default:
                throw new Error(`Unsupported file type: ${extension}`);
        }
    } catch (error: any) {
        console.error(`Error reading file ${filePath}:`, error.message);
        throw error;
    }
}