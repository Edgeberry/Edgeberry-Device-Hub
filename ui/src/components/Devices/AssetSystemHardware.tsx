import { useEffect, useState } from "react";
import { Col, Form, Row } from "react-bootstrap";
import NotificationBox from "../Notification";

const AssetSystemHardware = (props:{assetId:string, assetShadow:any })=>{
    const[ disabled, setDisabled ] = useState<boolean>(false);
    // Error or success messages
    const[ message, setMessage ] = useState<string>('');
    const[ isError, setIsError ] = useState<boolean>(false);

    // Disappearing messages
    useEffect(()=>{
        if( message === '' ) return;
        setTimeout(()=>{
            setMessage('');
            setIsError(false);
        },3500);
    },[message]);

    return(
        <>
            <h2>Hardware</h2>
            <Form>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Computing Platform</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Hardware Platform'} value={props.assetShadow?.state?.reported?.system?.system?.platform} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Hardware Board</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Hardware board'} value={props.assetShadow?.state?.reported?.system?.system?.board !== 'unknown' ?props.assetShadow?.state?.reported?.system?.system?.board +' Rev '+props.assetShadow?.state?.reported?.system?.system?.board_version:'unknown'} disabled/>
                    </Col>
                </Form.Group>
                <Form.Group as={Row} className="mb-2">
                    <Form.Label column sm={2}>Hardware UUID</Form.Label>
                    <Col sm={6}>
                        <Form.Control type={'text'} placeholder={'Hardware UUID'} value={props.assetShadow?.state?.reported?.system?.system?.uuid} disabled/>
                    </Col>
                </Form.Group>
                <NotificationBox message={message} isError={isError} />
            </Form>
        </>
    );
}

export default AssetSystemHardware;