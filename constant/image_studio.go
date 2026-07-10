package constant

const (
	ImageStudioDefaultBatchConcurrency = 10
	ImageStudioMaxBatchConcurrency     = 10
	ImageStudioDefaultTimeoutMinutes   = 10
	ImageStudioMinTimeoutMinutes       = 1
	ImageStudioMaxTimeoutMinutes       = 120
	ImageStudioDefaultRetentionDays    = 0
	ImageStudioMinRetentionDays        = 0
	ImageStudioMaxRetentionDays        = 3650
	ImageStudioDefaultPromptPresets    = `[
  {"id":"cpr-first-aid-guide","title":"心肺复苏急救步骤图","aspect_ratio":"9:16","tier":"4k","prompt":"制作一张面向普通成年人的高质量中文急救科普长图，主题是“有人突然倒地，怎样做心肺复苏”。画布为 9:16 竖版，四千级高清，信息详细但阅读顺序明确。整体使用 Chiikawa、Hachiware 和 Usagi 作为可爱形象引导员，角色造型前后一致，动作必须服务于急救讲解，不要让可爱风格削弱严肃性。版式：顶部标题区，下方严格按 1—8 顺序排列八个步骤卡片，使用清楚的大号数字、动作示意、短句对白和方向箭头；底部放置醒目的注意事项。所有内容只使用简体中文，不出现英文、拼音、日文、品牌、水印、二维码或无关文字。指定文字必须清晰、准确、各出现一次。标题准确呈现“心肺复苏急救步骤”。步骤一标题“先看周围是否安全”，说明“确认车辆、电线、火源等危险已经避开”，对白“先保护自己，才能救人！”。步骤二标题“轻拍双肩，大声呼唤”，说明“观察对方有没有回应”，对白“你能听见我吗？”。步骤三标题“马上呼救”，说明“请身边的人拨打120，并取来除颤器；如果只有你一个人，就打开手机免提拨打120”，对白“请你打120！请你去找除颤器！”。步骤四标题“检查有没有正常呼吸”，说明“观察胸口起伏，最多看10秒；偶尔抽气不算正常呼吸”，对白“没有正常呼吸，立即开始！”。步骤五标题“找准按压位置”，说明“让对方仰卧在硬地面，把一只手掌根放在胸口正中央，另一只手叠在上面，手指抬起”，对白“按在胸口正中央！”。步骤六标题“用力、快速按压胸口”，说明“手臂伸直，肩膀在双手正上方；每分钟按压100—120次，成人按下约5—6厘米，每次都让胸口完全回弹，尽量不要停”，对白“跟着节奏持续按！”。步骤七标题“会人工呼吸时，按30次吹2次”，说明“不会或不愿人工呼吸时，就持续按压胸口，不要因为犹豫而停止”，对白“不会吹气也没关系，继续按压！”。步骤八标题“拿到除颤器就立即使用”，说明“开机后听机器语音，按图贴好电极片；机器分析或提示电击时，所有人都不要碰患者；随后立刻继续按压”，对白“听机器指挥，不要中断！”。底部警示准确呈现“持续急救，直到患者恢复正常呼吸、专业人员接手，或现场变得不安全。”以及“本图适用于成人突然倒地且没有正常呼吸的紧急情况；儿童和婴儿操作不同，建议参加正规急救培训。”美术：Chiikawa 风格的柔和粉彩、圆润线条、干净白底与浅色分区，动作姿势清楚，患者使用无具体身份的简化成人形象；手掌位置、手臂角度、身体方向和除颤器贴片位置要符合真实急救逻辑。不要表现血腥、受伤特写、夸张哭闹、错误按压位置、把手放在腹部、多人同时触碰患者、文字重复或步骤错序。"},
  {"id":"messy-macos-chatgpt","title":"杂乱 macOS ChatGPT 截图","aspect_ratio":"16:9","tier":"hd","prompt":"生成一张以假乱真的 macOS 桌面全屏截图，像真实用户工作到深夜时随手截下的屏幕，而不是概念设计稿。前景是一个占据屏幕中央大部分区域的浏览器窗口，浏览器内打开 ChatGPT 对话页面：左侧有真实比例的会话边栏，中间是对话内容，底部是输入框。用户消息准确显示“draw me a dog”，助手回复区域准确显示一只由等宽字符组成、轮廓清楚的可爱小狗，并在下方显示一句简短回复“Here you go!”。浏览器标签栏、地址栏、前进后退按钮和窗口红黄绿控制点位置可信，但不要显示真实账号、邮箱、头像、密钥或个人信息。桌面有真实的杂乱感：后方交叠着两个终端窗口，一个显示普通的构建日志和命令提示符；旁边还有访达文件夹、备忘录、代码编辑器和一个只露出边缘的图片预览窗口。顶部菜单栏显示常见系统图标、无线网络、电量和时间，底部程序坞有轻微放大效果；桌面散落少量无隐私含义的文件和截图缩略图。视觉：高分辨率真实屏幕截图，标准 macOS 字体与间距，窗口阴影、半透明材质、滚动条、光标和像素边缘准确，信息密度自然，允许轻微凌乱和不完美。构图：16:9 横版，前景 ChatGPT 窗口最清晰，后台窗口可读但不抢主体。约束：不要生成电脑外壳、房间、手或相机拍屏效果；不要出现真实姓名、联系方式、通知内容、支付信息、验证码、密钥、乱码、水印或除指定对话外的大段随机文字。"},
  {"id":"anime-expression-grid","title":"银发少女十六宫格表情图","aspect_ratio":"1:1","tier":"hd","prompt":"创作一张高完成度的二次元动漫少女十六宫格表情设定图。画布为 1:1 正方形，严格使用 4×4 等大网格，格线整齐、留白一致，阅读顺序从左到右、从上到下。角色锚点：同一位年轻动漫少女，银色长发到胸口，发尾微卷，偏左分刘海，右侧固定一枚深蓝星形发夹；蓝色眼瞳带浅青高光；小巧鹅蛋脸；始终穿深蓝色水手领上衣、白色领巾和银色小月亮项链。十六格中的脸型、五官比例、发缝、刘海、发长、发夹位置、眼睛颜色、服装剪裁、项链和头肩比例必须高度一致，只改变表情、眉眼、嘴形和少量手势；每格均为相同机位、相同裁切范围的正面或轻微三分之二头肩特写，统一柔和棚拍光和纯净浅色背景。十六个表情按格子顺序依次为：第一格开心，灿烂笑容；第二格难过，嘴角下垂；第三格愤怒，皱眉鼓脸；第四格惊讶，睁大眼睛张嘴；第五格害羞，脸颊泛红目光躲闪；第六格无语，半睁眼平直嘴；第七格坏笑，单侧嘴角上扬；第八格沉思，手托下巴；第九格好奇，微微歪头；第十格得意，自信闭眼微笑；第十一格委屈，含泪抿嘴；第十二格鄙视，侧目轻皱眉；第十三格困惑，一高一低的眉毛并带小问号；第十四格害怕，瞳孔收紧双手靠近胸口；第十五格流泪，两行清晰泪水；第十六格爱心，双手在脸前比心，眼睛带爱心高光。美术：精致商业动漫角色设定稿，清爽赛璐璐上色结合柔和渐变，线稿干净，皮肤、发丝和眼睛细节丰富，表情差异一眼可辨。不要添加标题、表情名称、对白、编号、字幕、品牌或水印；不要改变角色身份，不要出现不同服装、不同发型、不同发色、不同年龄、重复表情、缺少格子、格子合并、额外人物、断手、多余手指或五官漂移。"}
]`
	ImageStudioDefaultSizePresets = `[
  {"id":"gpt-standard-square","group_pattern":"*","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"standard","tier_label":"Standard","width":1024,"height":1024,"enabled":true,"experimental":false},
  {"id":"gpt-standard-landscape","group_pattern":"*","model_pattern":"gpt-image*","aspect_ratio":"3:2","tier":"standard","tier_label":"Standard","width":1536,"height":1024,"enabled":true,"experimental":false},
  {"id":"gpt-standard-portrait","group_pattern":"*","model_pattern":"gpt-image*","aspect_ratio":"2:3","tier":"standard","tier_label":"Standard","width":1024,"height":1536,"enabled":true,"experimental":false},
  {"id":"gpt2-hd-square","group_pattern":"*","model_pattern":"gpt-image-2*","aspect_ratio":"1:1","tier":"hd","tier_label":"High definition","width":2048,"height":2048,"enabled":true,"experimental":false},
  {"id":"gpt2-hd-landscape","group_pattern":"*","model_pattern":"gpt-image-2*","aspect_ratio":"16:9","tier":"hd","tier_label":"High definition","width":2560,"height":1440,"enabled":true,"experimental":false},
  {"id":"gpt2-hd-portrait","group_pattern":"*","model_pattern":"gpt-image-2*","aspect_ratio":"9:16","tier":"hd","tier_label":"High definition","width":1440,"height":2560,"enabled":true,"experimental":false},
  {"id":"gpt2-4k-landscape","group_pattern":"*","model_pattern":"gpt-image-2*","aspect_ratio":"16:9","tier":"4k","tier_label":"4K","width":3840,"height":2160,"enabled":true,"experimental":true},
  {"id":"gpt2-4k-portrait","group_pattern":"*","model_pattern":"gpt-image-2*","aspect_ratio":"9:16","tier":"4k","tier_label":"4K","width":2160,"height":3840,"enabled":true,"experimental":true},
  {"id":"dalle3-square","group_pattern":"*","model_pattern":"dall-e-3*","aspect_ratio":"1:1","tier":"standard","tier_label":"Standard","width":1024,"height":1024,"enabled":true,"experimental":false},
  {"id":"dalle3-landscape","group_pattern":"*","model_pattern":"dall-e-3*","aspect_ratio":"7:4","tier":"standard","tier_label":"Standard","width":1792,"height":1024,"enabled":true,"experimental":false},
  {"id":"dalle3-portrait","group_pattern":"*","model_pattern":"dall-e-3*","aspect_ratio":"4:7","tier":"standard","tier_label":"Standard","width":1024,"height":1792,"enabled":true,"experimental":false},
  {"id":"dalle2-256","group_pattern":"*","model_pattern":"dall-e-2*","aspect_ratio":"1:1","tier":"small","tier_label":"256 px","width":256,"height":256,"enabled":true,"experimental":false},
  {"id":"dalle2-512","group_pattern":"*","model_pattern":"dall-e-2*","aspect_ratio":"1:1","tier":"medium","tier_label":"512 px","width":512,"height":512,"enabled":true,"experimental":false},
  {"id":"dalle2-1024","group_pattern":"*","model_pattern":"dall-e-2*","aspect_ratio":"1:1","tier":"standard","tier_label":"1024 px","width":1024,"height":1024,"enabled":true,"experimental":false}
]`
)
