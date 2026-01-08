
module.exports = {
    Innertube: {
        create: jest.fn().mockResolvedValue({
            session: {
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.0.0'
                    }
                }
            },
            call: jest.fn().mockResolvedValue({}),
            actions: {
                session: {
                    getStreamingData: jest.fn().mockResolvedValue({})
                }
            },
            getInfo: jest.fn().mockResolvedValue({
                basic_info: {
                    title: 'Mock Video Title',
                    channel: {
                        name: 'Mock Channel'
                    },
                    view_count: 1000,
                    like_count: 100
                },
                // Mock viewer count data for testing
                player_overlays: {
                    player_overlay_renderer: {
                        view_count: { text: '1,234 watching' }
                    }
                },
                video_details: {
                    view_count: '1234'
                }
            }),
            // Add other commonly used methods for completeness
            getBasicInfo: jest.fn().mockResolvedValue({
                basic_info: {
                    title: 'Mock Video Title',
                    view_count: 1000
                }
            })
        })
    }
};
