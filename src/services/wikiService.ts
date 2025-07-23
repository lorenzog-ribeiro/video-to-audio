import axios from 'axios';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

interface WikiConfig {
    baseUrl: string;
    apiKey: string;
}

interface WikiPage {
    id?: number;
    path: string;
    title: string;
    content: string;
    description?: string;
    isPublished?: boolean;
    tags?: string[];
    locale?: string;
}

export class WikiJSService {
    private config: WikiConfig;
    private axiosInstance: any;

    constructor() {
        this.config = {
            baseUrl: process.env.WIKIJS_BASE_URL || 'http://localhost:3000',
            apiKey: process.env.WIKIJS_API_KEY || ''
        };

        this.axiosInstance = axios.create({
            baseURL: `${this.config.baseUrl}/graphql`,
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Create a new page in Wiki.js
     */
    async createPage(page: WikiPage): Promise<any> {
        const mutation = `
            mutation CreatePage($content: String!, $description: String, $isPublished: Boolean, $locale: String!, $path: String!, $tags: [String]!, $title: String!) {
                pages {
                    create(content: $content, description: $description, isPublished: $isPublished, locale: $locale, path: $path, tags: $tags, title: $title) {
                        responseResult {
                            succeeded
                            errorCode
                            message
                        }
                        page {
                            id
                            path
                            title
                        }
                    }
                }
            }
        `;

        const variables = {
            content: page.content,
            description: page.description || '',
            isPublished: page.isPublished !== false,
            locale: page.locale || 'en',
            path: page.path,
            tags: page.tags || [],
            title: page.title
        };

        try {
            const response = await this.axiosInstance.post('', {
                query: mutation,
                variables
            });

            if (response.data.errors) {
                throw new Error(`WikiJS Error: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data.data.pages.create;
        } catch (error: any) {
            console.error('Error creating WikiJS page:', error.message);
            throw error;
        }
    }

    /**
     * Update an existing page in Wiki.js
     */
    async updatePage(pageId: number, page: Partial<WikiPage>): Promise<any> {
        const mutation = `
            mutation UpdatePage($id: Int!, $content: String, $description: String, $isPublished: Boolean, $path: String, $tags: [String], $title: String) {
                pages {
                    update(id: $id, content: $content, description: $description, isPublished: $isPublished, path: $path, tags: $tags, title: $title) {
                        responseResult {
                            succeeded
                            errorCode
                            message
                        }
                        page {
                            id
                            path
                            title
                        }
                    }
                }
            }
        `;

        const variables = {
            id: pageId,
            ...page
        };

        try {
            const response = await this.axiosInstance.post('', {
                query: mutation,
                variables
            });

            if (response.data.errors) {
                throw new Error(`WikiJS Error: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data.data.pages.update;
        } catch (error: any) {
            console.error('Error updating WikiJS page:', error.message);
            throw error;
        }
    }

    /**
     * Get a page by path
     */
    async getPageByPath(pagePath: string): Promise<any> {
        const query = `
            query GetPage($path: String!, $locale: String!) {
                pages {
                    single(path: $path, locale: $locale) {
                        id
                        path
                        title
                        content
                        description
                        tags
                        isPublished
                        createdAt
                        updatedAt
                    }
                }
            }
        `;

        const variables = {
            path: pagePath,
            locale: 'en'
        };

        try {
            const response = await this.axiosInstance.post('', {
                query,
                variables
            });

            if (response.data.errors) {
                throw new Error(`WikiJS Error: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data.data.pages.single;
        } catch (error: any) {
            console.error('Error getting WikiJS page:', error.message);
            throw error;
        }
    }

    /**
     * Upload markdown files from a directory to Wiki.js
     */
    async uploadMarkdownDirectory(markdownDir: string, basePath: string = 'transcriptions'): Promise<void> {
        try {
            const files = fs.readdirSync(markdownDir);
            const markdownFiles = files.filter(file => file.endsWith('.md'));

            console.log(`📤 Uploading ${markdownFiles.length} files to Wiki.js...`);

            for (const file of markdownFiles) {
                const filePath = path.join(markdownDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');

                // Extract title from filename or first heading
                const fileNameWithoutExt = path.basename(file, '.md');
                let title = fileNameWithoutExt.replace(/-/g, ' ').replace(/_/g, ' ');

                // Try to extract title from first H1 in content
                const titleMatch = content.match(/^#\s+(.+)$/m);
                if (titleMatch) {
                    title = titleMatch[1];
                }

                // Create page path
                const pagePath = `${basePath}/${fileNameWithoutExt}`;

                // Check if page already exists
                let existingPage = null;
                try {
                    existingPage = await this.getPageByPath(pagePath);
                } catch (error) {
                    // Page doesn't exist, which is fine
                }

                const pageData: WikiPage = {
                    path: pagePath,
                    title: title,
                    content: content,
                    description: `Transcription uploaded on ${new Date().toISOString()}`,
                    tags: ['transcription', 'automated'],
                    isPublished: true
                };

                try {
                    if (existingPage) {
                        // Update existing page
                        console.log(`   🔄 Updating: ${title}`);
                        await this.updatePage(existingPage.id, pageData);
                    } else {
                        // Create new page
                        console.log(`   ➕ Creating: ${title}`);
                        await this.createPage(pageData);
                    }
                    console.log(`   ✅ Success: ${title}`);
                } catch (error: any) {
                    console.error(`   ❌ Failed to upload ${file}:`, error.message);
                }

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`✅ Upload to Wiki.js completed!`);

        } catch (error: any) {
            console.error('❌ Error uploading to Wiki.js:', error.message);
            throw error;
        }
    }

    /**
     * Create a category/parent page for organizing transcriptions
     */
    async createCategoryPage(title: string, path: string, description: string): Promise<any> {
        const content = `# ${title}

${description}

## Contents

This section contains the following transcriptions:

<!-- Child pages will be automatically listed here by Wiki.js -->
`;

        return this.createPage({
            path,
            title,
            content,
            description,
            tags: ['category', 'transcription'],
            isPublished: true
        });
    }
}