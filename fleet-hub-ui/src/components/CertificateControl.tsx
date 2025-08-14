import { faEye, faPencil } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ChangeEventHandler, useEffect, useState } from "react";
import { Button, Form, InputGroup, Modal } from "react-bootstrap";

const CertificateControl = ( props:{ name:string, value:string, onChange:Function, disabled?:boolean})=>{
    // Message body
    const[ show, setShow ] = useState<boolean>(false);

    return(<>
            <InputGroup>
                <Form.Control type={'text'} value={props.value!==''?props.name:'None'} disabled/>
                <Button variant={'primary'} onClick={()=>{setShow(true)}}><FontAwesomeIcon icon={props.disabled?faEye:faPencil}/></Button>
            </InputGroup>
            <Modal size={'lg'} onHide={()=>{setShow(false)}} show={show} >
                <Modal.Header closeButton>
                    <Modal.Title>{props.name}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Control as={'textarea'} className="code" rows={28} value={props.value} onChange={props.onChange as ChangeEventHandler} spellCheck={false} disabled={props.disabled}/>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant={'primary'} onClick={()=>{setShow(false)}}>Done</Button>
                </Modal.Footer>
            </Modal>
        </>);
}

export default CertificateControl;