Shader "CollaborativeDR/FeatheredUnlitMask"
{
    Properties
    {
        _MainTex ("Optional replacement texture", 2D) = "white" {}
        _UseTexture ("Use texture", Float) = 0
        _Tint ("Tint", Color) = (1, 1, 1, 1)
        _Brightness ("Brightness", Range(0, 2)) = 1
        _Contrast ("Contrast", Range(0, 2)) = 1
        _Opacity ("Opacity", Range(0, 1)) = 1
        _FeatherUv ("Feather UV", Vector) = (0.005, 0.005, 0, 0)
    }

    SubShader
    {
        Tags
        {
            "Queue" = "Transparent"
            "RenderType" = "Transparent"
            "IgnoreProjector" = "True"
        }
        LOD 100
        Cull Off
        ZWrite Off
        Blend SrcAlpha OneMinusSrcAlpha

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                float2 featherMode : TEXCOORD1;
                fixed4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
                float sideFeather : TEXCOORD1;
                fixed vertexAlpha : COLOR;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            sampler2D _MainTex;
            float4 _MainTex_ST;
            float _UseTexture;
            float4 _Tint;
            float _Brightness;
            float _Contrast;
            float _Opacity;
            float4 _FeatherUv;

            v2f vert(appdata input)
            {
                v2f output;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.vertex = UnityObjectToClipPos(input.vertex);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                output.sideFeather = input.featherMode.x;
                output.vertexAlpha = input.color.a;
                return output;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                fixed4 sampled = tex2D(_MainTex, input.uv);
                fixed3 baseColour = lerp(fixed3(1, 1, 1), sampled.rgb, saturate(_UseTexture));
                fixed3 colour = (baseColour - 0.5) * _Contrast + 0.5;
                colour = saturate(colour * _Brightness) * _Tint.rgb;

                float2 edgeDistance = min(input.uv, 1.0 - input.uv);
                float edgeAlphaX = _FeatherUv.x <= 0.000001
                    ? 1.0
                    : smoothstep(0.0, _FeatherUv.x, edgeDistance.x);
                float edgeAlphaY = _FeatherUv.y <= 0.000001
                    ? 1.0
                    : smoothstep(0.0, _FeatherUv.y, edgeDistance.y);
                float topAlpha = min(edgeAlphaX, edgeAlphaY);
                float geometryAlpha = lerp(
                    topAlpha,
                    input.vertexAlpha,
                    saturate(input.sideFeather));
                float alpha = geometryAlpha * _Opacity * _Tint.a;
                return fixed4(colour, alpha);
            }
            ENDCG
        }
    }

    Fallback Off
}
