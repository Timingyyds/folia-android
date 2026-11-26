// src/components/shared/qqCommunity.ts
// 官方腾讯频道「Mineradio安卓端」。链接只在这里声明一份；帮助页「加入社区」里点击它直接跳转（原来的 QQ 群已换成腾讯频道）。

import { openOutsideLink } from '../../utils/system/outsideLink';

export const QQ_COMMUNITY_CHANNEL_URL = 'https://pd.qq.com/s/dt39dmevo?b=9';

export const openQqCommunityChannel = () => {
    void openOutsideLink(QQ_COMMUNITY_CHANNEL_URL);
};
