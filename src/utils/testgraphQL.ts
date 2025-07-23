// src/test-wikijs-connection.ts
import axios from 'axios';
import 'dotenv/config';

export async function testWikiJSConnection() {
    const baseUrl = process.env.WIKIJS_URL!;
    const apiKey = process.env.WIKIJS_API_KEY!;

    console.log('🔍 Testing Wiki.js Connection...');
    console.log(`📍 Base URL: ${baseUrl}`);
    console.log(`🔑 API Key: ${apiKey ? 'Configured' : 'Missing'}`);

    // Test 1: Basic GraphQL connectivity
    try {
        console.log('\n1️⃣ Testing GraphQL endpoint...');
        const response = await axios.post(
            `${baseUrl}/graphql`,
            {
                query: `
                    query {
                        system {
                            info {
                                currentVersion
                                latestVersion
                                latestVersionReleaseDate
                                operatingSystem
                                hostname
                                cpuCores
                                ramTotal
                                workingDirectory
                                nodeVersion
                                redisVersion
                                postgreVersion
                            }
                        }
                    }
                `
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        if (response.data.data?.system?.info) {
            console.log('✅ GraphQL endpoint is accessible');
            console.log('📊 System Info:', response.data.data.system.info);
        } else {
            console.log('❌ GraphQL endpoint returned unexpected response');
            console.log('Response:', response.data);
        }
    } catch (error: any) {
        console.error('❌ Failed to connect to GraphQL endpoint');
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }

    // Test 2: List existing pages
    try {
        console.log('\n2️⃣ Testing page listing...');
        const response = await axios.post(
            `${baseUrl}/graphql`,
            {
                query: `
                    query {
                        pages {
                            list(orderBy: CREATED, orderByDirection: DESC, limit: 5) {
                                id
                                path
                                title
                                createdAt
                            }
                        }
                    }
                `
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.data?.pages?.list) {
            console.log('✅ Can list pages');
            console.log(`📄 Found ${response.data.data.pages.list.length} recent pages`);
            response.data.data.pages.list.forEach((page: any) => {
                console.log(`   - ${page.title} (${page.path})`);
            });
        }
    } catch (error: any) {
        console.error('❌ Failed to list pages');
        console.error('Error:', error.message);
    }

    // Test 3: Create a test page
    try {
        console.log('\n3️⃣ Testing page creation...');
        const testPath = `test/connection-test-${Date.now()}`;
        
        const response = await axios.post(
            `${baseUrl}/graphql`,
            {
                query: `
                    mutation Page($content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $isPrivate: Boolean!, $locale: String!, $path: String!, $tags: [String]!, $title: String!) {
                        pages {
                            create(
                                content: $content
                                description: $description
                                editor: $editor
                                isPublished: $isPublished
                                isPrivate: $isPrivate
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
                                    path
                                    title
                                }
                            }
                        }
                    }
                `,
                variables: {
                    content: '# Test Page\n\nThis is a test page created by the connection test script.',
                    description: 'Test page for API connection',
                    editor: 'markdown',
                    isPublished: true,
                    isPrivate: false,
                    locale: 'en',
                    path: testPath,
                    tags: ['test', 'api-test'],
                    title: 'Connection Test Page'
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.errors) {
            console.error('❌ GraphQL errors:', response.data.errors);
        } else if (response.data.data?.pages?.create?.responseResult?.succeeded) {
            console.log('✅ Successfully created test page');
            console.log(`📄 Page URL: ${baseUrl}/${testPath}`);
            console.log('Page details:', response.data.data.pages.create.page);
        } else {
            console.log('❌ Failed to create page');
            console.log('Response:', response.data.data?.pages?.create?.responseResult);
        }
    } catch (error: any) {
        console.error('❌ Failed to create test page');
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }

    console.log('\n✅ Connection test completed');
}

// Run the test
testWikiJSConnection().catch(console.error);