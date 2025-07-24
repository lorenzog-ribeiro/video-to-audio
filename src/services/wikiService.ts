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

    console.log("🔍 Variables criadas:", variables);

    const body = {
        query: CREATE_PAGE,
        variables: variables
    };

    console.log("▶️ Enviando body:", JSON.stringify(body, null, 2));

    try {
        const resp = await axios({
            method: 'POST',
            url: wiki_base!,
            data: body,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${wiki_token}`
            },
            maxRedirects: 0 // Impede redirecionamentos
        });

        console.log("✅ Resposta completa:", resp.data);

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